require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      // Tuned for the hot path: pools and auctions are called constantly, so
      // they optimise for runtime gas.
      optimizer: { enabled: true, runs: 200 },
    },
    overrides: {
      // The factory embeds the bytecode of everything it deploys, which pushed
      // it past the 24,576-byte contract limit. It runs once per round, so
      // optimising it for size instead of speed costs nothing that matters —
      // and doing it here rather than globally keeps trading gas where it was.
      "RoundFactory.sol": {
        version: "0.8.24",
        settings: { optimizer: { enabled: true, runs: 1 } },
      },
    },
  },
  paths: {
    sources: "./src",
  },
  networks: {
    // Forked 46630, so migration can be tested against the REAL Uniswap v4
    // PoolManager and PositionManager rather than a mock of them. A mock only
    // proves we encoded what we intended; this proves Uniswap accepts it.
    hardhat: {
      // FORK=1 forks the testnet; FORK=mainnet forks 4663, which is how the
      // mainnet deployment gets rehearsed against real state for free.
      // Report the forked chain's id, not hardhat's 31337, so anything that
      // branches on chainId behaves as it will live.
      chainId: process.env.FORK === "mainnet" ? 4663 : process.env.FORK ? 46630 : 31337,
      forking: process.env.FORK
        ? {
            url:
              process.env.FORK === "mainnet"
                ? (process.env.RH_RPC ?? "https://rpc.mainnet.chain.robinhood.com")
                : (process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com"),
          }
        : undefined,
    },
    // Real money. Nothing deploys here without scripts/preflight.cjs passing.
    robinhood: {
      url: process.env.RH_RPC ?? "https://rpc.mainnet.chain.robinhood.com",
      chainId: 4663,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    // The real target chain. Faucet: https://faucet.testnet.chain.robinhood.com
    robinhoodTestnet: {
      url: process.env.RH_TESTNET_RPC ?? "https://rpc.testnet.chain.robinhood.com",
      chainId: 46630,
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
    // Kept as a fallback testnet in case the Robinhood chain has issues.
    arbitrumSepolia: {
      url: process.env.ARB_SEPOLIA_RPC ?? "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [],
    },
  },
};
