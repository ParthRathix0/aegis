// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title AquaRouter — routes uncrossed batch remainder to the official 1inch Aqua / SwapVM.
///
/// @dev 1inch Aqua / SwapVM reference (fetched from the 1inch Aqua docs + repos at execution time,
///      Sept 2026 — do not trust from memory, re-verify at deploy):
///        - SwapVM router (deterministic, same address on every supported chain incl. Ethereum
///          mainnet, Base, Optimism, Arbitrum, Polygon, …): 0x111111338c5091E8440b67B168bAe16a668AC0De
///        - Aqua registry (deterministic): 0x1111113CcF1426a8E30E2Bff5E005D929bf6a90a
///        - Repos: github.com/1inch/swap-vm (SwapVMRouter, inherits SwapVM) and github.com/1inch/aqua
///        - Swap entrypoint (SwapVMRouter):
///            swap(ISwapVM.Order order, address tokenIn, address tokenOut, uint256 amount,
///                 bytes takerData) returns (uint256 actualIn, uint256 actualOut, bytes32 orderHash)
///        - Calldata / takerData is produced OFF-CHAIN by the 1inch Aqua SDK
///          (github.com/1inch/sdks -> typescript/aqua): the taker discovers a maker Order via the
///          Aqua indexer/API (needs ONEINCH_API_KEY), then packs taker params with TakerTraitsLib.
///
/// This router is intentionally VENUE-AGNOSTIC: it forwards opaque `aquaCalldata` (the ABI-encoded
/// `swap(...)` call built by the Aqua SDK) to the `aqua` entrypoint and settles by measured balance
/// delta. That keeps the onchain surface minimal and forward-compatible with SwapVM opcode changes —
/// the Solver Agent (Plan 5 executor) builds the calldata; the contract only moves + accounts tokens.
contract AquaRouter {
    using SafeERC20 for IERC20;

    /// @notice The 1inch Aqua / SwapVM entrypoint this router forwards swaps to.
    address public immutable aqua;

    constructor(address _aqua) {
        require(_aqua != address(0), "aqua=0");
        aqua = _aqua;
    }

    /// @notice Route `amountIn` of `tokenIn` into `tokenOut` via 1inch Aqua/SwapVM.
    /// @param tokenIn      Asset being sold (the uncrossed batch remainder).
    /// @param tokenOut     Asset to receive.
    /// @param amountIn     Exact input amount (pulled from `msg.sender`).
    /// @param minOut       Minimum acceptable output (slippage guard; agent sets from Aqua quote).
    /// @param aquaCalldata ABI-encoded SwapVM `swap(...)` call produced by the 1inch Aqua SDK.
    /// @return amountOut   `tokenOut` received and forwarded back to `msg.sender`.
    function routeExactIn(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        bytes calldata aquaCalldata
    ) external returns (uint256 amountOut) {
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).forceApprove(aqua, amountIn);

        uint256 balBefore = IERC20(tokenOut).balanceOf(address(this));
        (bool ok, ) = aqua.call(aquaCalldata);
        require(ok, "Aqua swap failed");
        amountOut = IERC20(tokenOut).balanceOf(address(this)) - balBefore;

        require(amountOut >= minOut, "Insufficient output");

        // Clear any residual allowance (SwapVM may not pull the full amount).
        IERC20(tokenIn).forceApprove(aqua, 0);

        IERC20(tokenOut).safeTransfer(msg.sender, amountOut);
    }
}
