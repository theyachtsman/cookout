// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @dev TEST ONLY — never deployed. Lets the suite point a BatchAuction at
///      pathological reserves that honest RoundPool constructors cannot
///      produce (e.g. a zero token reserve), proving settle()'s zero-token
///      guards keep escrow solvent regardless of the pool's invariants.
contract MockRoundPool {
    uint256 private ethR;
    uint256 private tokenR;
    /// @notice ETH received by auctionBuy — the test asserts this stays 0
    ///         when the guards fire (no escrow may leave the auction).
    uint256 public receivedWei;
    bool public opened;

    function setReserves(uint256 e, uint256 t) external {
        ethR = e;
        tokenR = t;
    }

    function getReserves() external view returns (uint256, uint256) {
        return (ethR, tokenR);
    }

    function auctionBuy() external payable returns (uint256) {
        opened = true;
        receivedWei += msg.value;
        return 0;
    }
}
