// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title BatchAuction — uniform-price fair matching primitive (reusable Uniswap hook core)
/// @notice Standalone, dependency-free extraction of Aegis's batch-auction fill logic. Given the
///         aggregate BUY and SELL volumes accumulated in a batch (expressed in a common unit — e.g.
///         SELL base volume valued in quote), it returns the 1e18-scaled fraction of each side that
///         crosses at the uniform clearing price. The smaller side fills 100%; the larger side fills
///         pro-rata (smaller/larger). The uncrossed remainder of the larger side is what a caller
///         routes to an external venue (see AquaRouter).
/// @dev    Designed to drop into a Uniswap v4 `beforeSwap`/settlement hook as the matching core:
///         a hook accumulates intents over a block window and calls `fillRatios` to settle them at
///         one honest price, eliminating intra-batch MEV. Pure, no storage, no external calls.
library BatchAuction {
    /// @notice Fixed-point scale for the returned ratios (1e18 == fully filled).
    uint256 internal constant PRECISION = 1e18;

    /// @notice Compute the 1e18-scaled fill fraction for each side of a batch.
    /// @param buyVol  Aggregate BUY volume in the common unit.
    /// @param sellVol Aggregate SELL volume in the common unit.
    /// @return buyRatio  Fraction of BUY volume that fills (1e18 == 100%).
    /// @return sellRatio Fraction of SELL volume that fills (1e18 == 100%).
    function fillRatios(uint256 buyVol, uint256 sellVol)
        internal
        pure
        returns (uint256 buyRatio, uint256 sellRatio)
    {
        if (buyVol == 0 || sellVol == 0) return (0, 0);
        buyRatio = buyVol <= sellVol ? PRECISION : (sellVol * PRECISION) / buyVol;
        sellRatio = sellVol <= buyVol ? PRECISION : (buyVol * PRECISION) / sellVol;
    }
}

/// @notice Thin external wrapper used only by tests to exercise the internal library.
contract BatchAuctionHarness {
    function fillRatios(uint256 b, uint256 s) external pure returns (uint256, uint256) {
        return BatchAuction.fillRatios(b, s);
    }
}
