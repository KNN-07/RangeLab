// Build: c++ -O3 -std=c++17 -pthread tools/build-equities.cpp -o build-equities
// Run the updater in this project: node tools/update-equities.mjs ./build-equities
//
// The first output block is the strict lower triangle of split-pot equity.
// The second block is the lower triangle, including the diagonal, of tie rates.
// Entries are unsigned little-endian fractions on [0, 65535]. Blocks use the
// conventional AKQJT98765432 matrix, row-major, with suited hands above pairs.
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <thread>
#include <vector>

namespace {
constexpr int classCount = 169;
constexpr int trials = 12288;
using SuitMasks = std::array<int, 4>;
struct Holding { int a, b; };

struct Random {
    uint64_t state;
    unsigned draw(unsigned bound) {
        state ^= state >> 12;
        state ^= state << 25;
        state ^= state >> 27;
        const uint32_t value = (state * 2685821657736338717ULL) >> 32;
        return (static_cast<uint64_t>(value) * bound) >> 32;
    }
};

std::array<int, 8192> straightHigh, high, topFive, bitCount;
std::array<std::vector<Holding>, classCount> classes;
std::array<uint16_t, classCount * classCount> equities, ties;

int highestRanks(int mask, int count) {
    int value = 0;
    for (int i = 0; mask && i < count; ++i) {
        const int rank = high[mask];
        value = value * 16 + rank;
        mask ^= 1 << rank;
    }
    return value;
}

void initialize() {
    high[0] = -1;
    for (int mask = 0; mask < 8192; ++mask) {
        if (mask) {
            high[mask] = 1 + high[mask >> 1];
            bitCount[mask] = bitCount[mask >> 1] + (mask & 1);
        }
        straightHigh[mask] = -1;
        for (int rank = 12; rank >= 4; --rank) {
            if (((mask >> (rank - 4)) & 31) == 31) {
                straightHigh[mask] = rank;
                break;
            }
        }
        if (straightHigh[mask] < 0 && (mask & 4111) == 4111) straightHigh[mask] = 3;
        topFive[mask] = highestRanks(mask, 5);
    }
    for (int a = 0; a < 52; ++a) {
        for (int b = a + 1; b < 52; ++b) {
            const int low = 12 - a / 4, high = 12 - b / 4;
            const int index = a % 4 == b % 4 ? high * 13 + low : low * 13 + high;
            classes[index].push_back({a, b});
        }
    }
}

// High 8 bits encode the category. Kickers use high-rank-first hexadecimal digits.
int evaluate(SuitMasks suits, Holding hole) {
    suits[hole.a % 4] |= 1 << (hole.a / 4);
    suits[hole.b % 4] |= 1 << (hole.b / 4);
    for (int mask : suits) {
        if (bitCount[mask] < 5) continue;
        if (straightHigh[mask] >= 0) return (8 << 24) + straightHigh[mask];
        return (5 << 24) + topFive[mask];
    }
    const int a = suits[0], b = suits[1], c = suits[2], d = suits[3];
    const int ab = a & b, cd = c & d, left = a | b, right = c | d, all = left | right;
    const int four = ab & cd;
    if (four) return (7 << 24) + high[four] * 16 + high[all ^ four];
    const int two = ab | cd | (left & right), three = (ab & right) | (cd & left);
    if (three) {
        const int trips = high[three], rest = two ^ (1 << trips);
        if (rest) return (6 << 24) + trips * 16 + high[rest];
    }
    if (straightHigh[all] >= 0) return (4 << 24) + straightHigh[all];
    if (three) return (3 << 24) + high[three] * 256 + highestRanks(all ^ three, 2);
    if (two) {
        const int top = high[two], otherPairs = two ^ (1 << top);
        if (otherPairs) {
            const int second = high[otherPairs];
            return (2 << 24) + top * 256 + second * 16 + high[all ^ (1 << top) ^ (1 << second)];
        }
        return (1 << 24) + top * 4096 + highestRanks(all ^ two, 3);
    }
    return topFive[all];
}

void sample(int i, int j) {
    // All representatives are equivalent under suit relabeling.
    const Holding hero = classes[i].front();
    std::vector<Holding> opponents;
    std::vector<std::array<int, 48>> decks;
    for (const Holding villain : classes[j]) {
        if (villain.a == hero.a || villain.a == hero.b || villain.b == hero.a || villain.b == hero.b) continue;
        opponents.push_back(villain);
        std::array<int, 48> deck;
        int count = 0;
        for (int card = 0; card < 52; ++card) {
            if (card != hero.a && card != hero.b && card != villain.a && card != villain.b) {
                deck[count++] = card;
            }
        }
        decks.push_back(deck);
    }
    Random random{0x58afcb0345ea86d1ULL ^ static_cast<uint64_t>(1 + i * classCount + j) * 0x87fa0747aae32567ULL};
    int points = 0, tiesSeen = 0;
    for (int t = 0; t < trials; ++t) {
        const int opponent = random.draw(opponents.size());
        auto &deck = decks[opponent];
        SuitMasks board{};
        for (int k = 0; k < 5; ++k) {
            const int pick = k + random.draw(48 - k);
            const int card = deck[pick];
            std::swap(deck[k], deck[pick]);
            board[card % 4] |= 1 << (card / 4);
        }
        const int own = evaluate(board, hero), other = evaluate(board, opponents[opponent]);
        tiesSeen += own == other;
        points += (own > other) + (own >= other);
    }
    equities[i * classCount + j] = (uint64_t(points) * 65535 + trials) / (2 * trials);
    ties[i * classCount + j] = (uint64_t(tiesSeen) * 65535 + trials / 2) / trials;
}

void emit(std::ofstream &out, uint16_t value) {
    out.put(static_cast<char>(value & 255));
    out.put(static_cast<char>(value >> 8));
}
}

int main(int argc, char **argv) {
    if (argc != 2) { std::cerr << "Usage: build-equities OUTPUT.bin\n"; return 2; }
    initialize();
    std::atomic<int> next{0};
    std::vector<std::thread> workers;
    const unsigned count = std::clamp(std::thread::hardware_concurrency(), 1U, 8U);
    for (unsigned t = 0; t < count; ++t) {
        workers.emplace_back([&]() {
            for (int i; (i = next++) < classCount;) {
                for (int j = 0; j <= i; ++j) sample(i, j);
            }
        });
    }
    for (auto &worker : workers) worker.join();
    std::ofstream out(argv[1], std::ios::binary);
    for (int i = 0; i < classCount; ++i) {
        for (int j = 0; j < i; ++j) emit(out, equities[i * classCount + j]);
    }
    for (int i = 0; i < classCount; ++i) {
        for (int j = 0; j <= i; ++j) emit(out, ties[i * classCount + j]);
    }
    out.close();
    return out ? 0 : 1;
}
