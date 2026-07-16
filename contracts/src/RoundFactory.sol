// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArenaToken} from "./ArenaToken.sol";
import {BatchAuction} from "./BatchAuction.sol";
import {RoundPool} from "./RoundPool.sol";

/// @title RoundFactory — template-only round deployment (spec §5.2)
/// @notice The single entry point for creating a round on-chain: token, pool,
///         and auction all deploy from fixed bytecode in one transaction, so
///         "creators supply metadata, never code" is enforced by construction.
///         The factory holds no post-deploy rights over any round it creates.
contract RoundFactory {
    /// @notice Hard cap on both fee streams. Creation is permissionless, so
    ///         without this a round with a ~100% sell fee is a honeypot that
    ///         passes every other trust property. 5% leaves ample headroom
    ///         over the 1% the platform actually charges.
    uint16 public constant MAX_FEE_BPS = 500;

    struct RoundAddresses {
        address token;
        address pool;
        address auction;
        address creator;
        uint64 createdAt;
    }

    RoundAddresses[] public rounds;

    event RoundCreated(
        uint256 indexed id,
        address indexed creator,
        address token,
        address pool,
        address auction
    );

    struct RoundParams {
        string name;
        string symbol;
        uint256 totalSupply; // all of it seeds the pool
        uint64 queueClosesAt;
        uint64 endTime;
        uint256 auctionMaxRaiseWei;
        uint16 auctionFeeBps;
        uint16 tradeFeeBps;
        uint256 mcapTargetWei;
        uint256 graduationMcapWei;
        uint256 graduationMinVolumeWei;
        uint256 graduationMinHolders;
        address feeRecipient;
        address creator;
    }

    function roundCount() external view returns (uint256) {
        return rounds.length;
    }

    /// @notice Deploys a full round. msg.value seeds pool liquidity.
    function createRound(RoundParams calldata p)
        external
        payable
        returns (address tokenAddr, address poolAddr, address auctionAddr)
    {
        require(msg.value > 0, "liquidity");
        require(p.totalSupply > 0, "supply");
        require(p.tradeFeeBps <= MAX_FEE_BPS && p.auctionFeeBps <= MAX_FEE_BPS, "fee too high");
        require(p.feeRecipient != address(0), "fee recipient");
        require(p.queueClosesAt > block.timestamp, "queue closes in past");
        require(p.endTime > p.queueClosesAt, "ends before queue closes");
        ArenaToken token = new ArenaToken(p.name, p.symbol, p.totalSupply, address(this));
        RoundPool pool = new RoundPool(
            token,
            p.feeRecipient,
            p.tradeFeeBps,
            p.endTime,
            p.mcapTargetWei,
            p.graduationMcapWei,
            p.graduationMinVolumeWei,
            p.graduationMinHolders
        );
        BatchAuction auction = new BatchAuction(
            pool,
            token,
            p.queueClosesAt,
            p.auctionMaxRaiseWei,
            p.auctionFeeBps,
            p.feeRecipient
        );
        pool.initAuction(address(auction));
        require(token.transfer(address(pool), p.totalSupply), "seed tokens");
        pool.initialize{value: msg.value}();

        uint256 id = rounds.length;
        rounds.push(
            RoundAddresses(address(token), address(pool), address(auction), p.creator, uint64(block.timestamp))
        );
        emit RoundCreated(id, p.creator, address(token), address(pool), address(auction));
        return (address(token), address(pool), address(auction));
    }
}
