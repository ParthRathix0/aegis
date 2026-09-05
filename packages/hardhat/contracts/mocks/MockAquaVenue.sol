// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Minimal stand-in for the 1inch Aqua/SwapVM entrypoint, for deterministic (non-fork)
///         tests of AquaRouter + AegisV4 uncrossed routing. `swap` mirrors the shape of a SwapVM
///         fill: pull `amountIn` of `tokenIn` from the caller (which has approved this venue) and
///         deliver a pre-agreed `amountOut` of `tokenOut` to `to`. Must be pre-funded with tokenOut.
///         The real Aqua calldata (from the Aqua SDK) replaces the calldata built for this in prod.
contract MockAquaVenue {
    using SafeERC20 for IERC20;

    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        address to
    ) external {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).safeTransfer(to, amountOut);
    }
}
