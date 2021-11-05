import { Address } from '@graphprotocol/graph-ts'

export let ROCKETPOOL_THEGRAPH_HELPER_CONTACT_ADDRESS_NAME = '0x1435AdC6C5BD4510759A81087f3ddC483864Ce01';

// Used when encountering the ZERO address.
export let ZERO_ADDRESS_STRING = '0x0000000000000000000000000000000000000000';
export let ZERO_ADDRESS = Address.fromString(ZERO_ADDRESS_STRING);

// Represents the eternal storage that holds all the RocketPool state. (including most latest RP contracts by name)
export let ROCKET_STORAGE_STRING = "0xd8Cd47263414aFEca62d6e2a3917d6600abDceB3";
export let ROCKET_STORAGE_ADDRESS = Address.fromString(
  ROCKET_STORAGE_STRING,
)

// Used to determine the latest contract address that is associated the names below.
export let ROCKET_TOKEN_RETH_CONTRACT_NAME = 'rocketTokenRETH';
export let ROCKET_DEPOSIT_POOL_CONTRACT_NAME = "rocketDepositPool";
export let ROCKET_MINIPOOL_MANAGER_CONTRACT_NAME = 'rocketMinipoolManager';
export let ROCKET_NODE_MANAGER_CONTRACT_NAME = "rocketNodeManager";
export let ROCKET_NODE_STAKING_CONTRACT_NAME = 'rocketNodeStaking';
export let ROCKET_REWARDS_POOL_CONTRACT_NAME= 'rocketRewardsPool';
export let ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME= 'rocketClaimDAO';
export let ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME= 'rocketDAONodeTrusted';
export let ROCKET_NETWORK_PRICES_CONTRACT_NAME= 'rocketNetworkPrices';
export let ROCKET_NETWORK_FEES_CONTRACT_NAME = 'rocketNetworkFees';
export let ROCKET_DAO_PROTOCOL_SETTINGS_MINIPOOL = 'rocketDAOProtocolSettingsMinipool';
export let ROCKET_DAO_PROTOCOL_SETTINGS_NODE = 'rocketDAOProtocolSettingsNode';