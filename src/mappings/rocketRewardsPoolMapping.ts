import { BigInt, Address } from "@graphprotocol/graph-ts";
import {
  rocketRewardsPool,
  RPLTokensClaimed
} from "../../generated/rocketRewardsPool/rocketRewardsPool";
import { rocketDAONodeTrusted } from "../../generated/rocketRewardsPool/rocketDAONodeTrusted";
import { rocketStorage } from "../../generated/rocketRewardsPool/rocketStorage";
import { rocketNetworkPrices } from "../../generated/rocketRewardsPool/rocketNetworkprices";
import {
  RPLRewardClaim,
  RPLRewardInterval,
  Node
} from "../../generated/schema";
import { generalUtilities } from "../utilities/generalutilities";
import { rocketPoolEntityFactory } from "../entityfactory";
import {
  ONE_ETHER_IN_WEI,
  ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX
} from "../constants/generalconstants";
import {
  ROCKET_STORAGE_ADDRESS,
  ROCKET_REWARDS_POOL_CONTRACT_NAME,
  ROCKET_NETWORK_PRICES_CONTRACT_NAME,
  ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME,
  ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME
} from "../constants/contractconstants";
import {
  RPLREWARDCLAIMERTYPE_PDAO,
  RPLREWARDCLAIMERTYPE_TRUSTEDNODE,
  RPLREWARDCLAIMERTYPE_NODE
} from "../constants/enumconstants";

/**
 * Occurs when an eligible stakeholder on the protocol claims an RPL reward.
 */
export function handleRPLTokensClaimed(event: RPLTokensClaimed): void {
  if (
    event === null ||
    event.params === null ||
    event.params.claimingAddress === null ||
    event.params.claimingContract === null ||
    event.block === null
  )
    return;

  // Protocol entity should exist, if not, then we attempt to create it.
  let protocol = generalUtilities.getRocketPoolProtocolEntity();
  if (protocol === null || protocol.id == null) {
    protocol = rocketPoolEntityFactory.createRocketPoolProtocol();
  }
  if (protocol === null) return

  // We will need the rocketvault smart contract state to get specific addresses.
  let rocketStorageContract = rocketStorage.bind(ROCKET_STORAGE_ADDRESS);

  // We will need the rocket rewards pool contract to get its smart contract state.
  let rocketRewardPoolContract = rocketRewardsPool.bind(
    rocketStorageContract.getAddress(
      generalUtilities.getRocketVaultContractAddressKey(
        ROCKET_REWARDS_POOL_CONTRACT_NAME
      )
    )
  );

  // We need to retrieve the last RPL rewards interval so we can compare it to the current state in the smart contracts.
  let activeIndexedRewardInterval: RPLRewardInterval | null = null;
  let lastRPLRewardIntervalId = protocol.lastRPLRewardInterval;
  if (lastRPLRewardIntervalId != null) {
    activeIndexedRewardInterval = RPLRewardInterval.load(
      <string>lastRPLRewardIntervalId
    );
  }

  // Determine claimer type based on the claiming contract and/or claiming address.
  let rplRewardClaimerType: string | null = getRplRewardClaimerType(
    rocketStorageContract,
    event.params.claimingContract,
    event.params.claimingAddress
  );

  // Something is wrong; the contract associated with this claim couldn't be processed.
  // Maybe this implementation needs to be updated as a result of a contract upgrade of RocketPool.
  if (rplRewardClaimerType == null) return;

  // If we don't have an indexed RPL Reward interval,
  // or if the last indexed RPL Reward interval isn't equal to the current one in the smart contracts:
  let smartContractCurrentRewardIntervalStartTime = rocketRewardPoolContract.getClaimIntervalTimeStart();
  let previousActiveIndexedRewardInterval: RPLRewardInterval | null = null;
  let previousActiveIndexedRewardIntervalId: string | null = null;
  if (
    activeIndexedRewardInterval === null ||
    activeIndexedRewardInterval.intervalStartTime !=
    smartContractCurrentRewardIntervalStartTime
  ) {
    // If there was an indexed RPL Reward interval which has a different start time then the interval in the smart contracts.
    if (activeIndexedRewardInterval !== null) {
      // We need to close our indexed RPL Rewards interval.
      activeIndexedRewardInterval.intervalClosedTime = event.block.timestamp;
      activeIndexedRewardInterval.isClosed = true;
      activeIndexedRewardInterval.intervalDurationActual = event.block.timestamp.minus(
        activeIndexedRewardInterval.intervalStartTime
      );
      if (activeIndexedRewardInterval.intervalDurationActual < BigInt.fromI32(0)) {
        activeIndexedRewardInterval.intervalDurationActual = activeIndexedRewardInterval.intervalDuration;
      }
      previousActiveIndexedRewardInterval = activeIndexedRewardInterval;
      previousActiveIndexedRewardIntervalId =
        previousActiveIndexedRewardInterval.id;
    }

    // Create a new RPL Reward interval so we can add this first claim to it.
    activeIndexedRewardInterval = rocketPoolEntityFactory.createRPLRewardInterval(
      ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX +
      generalUtilities.extractIdForEntity(event),
      previousActiveIndexedRewardIntervalId,
      rocketRewardPoolContract.getClaimIntervalRewardsTotal(),
      smartContractCurrentRewardIntervalStartTime,
      rocketRewardPoolContract.getClaimIntervalTime(),
      event.block.number,
      event.block.timestamp
    );
    if (activeIndexedRewardInterval === null) return;
    protocol.lastRPLRewardInterval = activeIndexedRewardInterval.id;

    if (previousActiveIndexedRewardInterval !== null) {
      previousActiveIndexedRewardInterval.nextIntervalId =
        activeIndexedRewardInterval.id;
    }
  }
  if (activeIndexedRewardInterval === null) return;

  // We need this to determine the current RPL/ETH price based on the smart contracts.
  // If for some reason this fails, something is horribly wrong and we need to stop indexing.
  let networkPricesContractAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_NETWORK_PRICES_CONTRACT_NAME
    )
  );
  let networkPricesContract = rocketNetworkPrices.bind(
    networkPricesContractAddress
  );
  let rplETHExchangeRate = networkPricesContract.getRPLPrice();
  let rplRewardETHAmount = BigInt.fromI32(0);
  if (rplETHExchangeRate > BigInt.fromI32(0)) {
    rplRewardETHAmount = event.params.amount
      .times(rplETHExchangeRate)
      .div(ONE_ETHER_IN_WEI);
  }

  // Create a new reward claim.
  let rplRewardClaim = rocketPoolEntityFactory.createRPLRewardClaim(
    generalUtilities.extractIdForEntity(event),
    event.params.claimingAddress.toHexString(),
    <string>rplRewardClaimerType,
    event.params.amount,
    rplRewardETHAmount,
    event.block.number,
    event.block.timestamp
  );
  if (rplRewardClaim === null) return;

  // If the claimer was a (trusted) node, then increment its total claimed rewards.
  let associatedNode = Node.load(event.params.claimingAddress.toHexString());
  if (associatedNode !== null) {
    associatedNode.totalClaimedRPLRewards = associatedNode.totalClaimedRPLRewards.plus(
      event.params.amount
    );
  }

  // Update the grand total claimed of the current interval.
  activeIndexedRewardInterval.totalRPLClaimed = activeIndexedRewardInterval.totalRPLClaimed.plus(
    rplRewardClaim.amount
  );

  // Update the average claimed of the current interval.
  if (activeIndexedRewardInterval.totalRPLClaimed > BigInt.fromI32(0) &&
    activeIndexedRewardInterval.rplRewardClaims !== null &&
    activeIndexedRewardInterval.rplRewardClaims.length > 0) {

    activeIndexedRewardInterval.averageRPLClaimed =
      activeIndexedRewardInterval.totalRPLClaimed.div(
        BigInt.fromI32(activeIndexedRewardInterval.rplRewardClaims.length));
  }

  // Add this reward claim to the current interval
  let currentRPLRewardClaims = activeIndexedRewardInterval.rplRewardClaims;
  currentRPLRewardClaims.push(rplRewardClaim.id);
  activeIndexedRewardInterval.rplRewardClaims = currentRPLRewardClaims;

  // Index changes to the (new/previous) interval and claim.
  rplRewardClaim.save();
  if (associatedNode !== null) associatedNode.save();
  if (previousActiveIndexedRewardInterval !== null)
    previousActiveIndexedRewardInterval.save();
  activeIndexedRewardInterval.save();

  // Update the RPL Rank for the protocol nodes and index the protocol changes.
  updateRPLClaimedRewardRank(protocol.nodes);
  protocol.save();
}

/**
 * Checks if the given address is actually a trusted node.
 */
function getIsTrustedNode(
  rocketStorageContract: rocketStorage,
  address: Address
): boolean {
  let isTrustedNode: boolean = false;

  let rocketDaoNodeTrustedAddress = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_NODE_TRUSTED_CONTRACT_NAME
    )
  );
  if (rocketDaoNodeTrustedAddress !== null) {
    let rocketDaoNodeTrustedContract = rocketDAONodeTrusted.bind(
      rocketDaoNodeTrustedAddress
    );
    isTrustedNode =
      rocketDaoNodeTrustedContract !== null &&
      rocketDaoNodeTrustedContract.getMemberIsValid(address);
  }

  return isTrustedNode;
}

/**
 * Determine the claimer type for a specific RPL reward claim event.
 */
function getRplRewardClaimerType(
  rocketStorageContract: rocketStorage,
  claimingContract: Address,
  claimingAddress: Address
): string | null {
  let rplRewardClaimerType: string | null = null;
  if (
    rocketStorageContract === null ||
    claimingContract === null ||
    claimingAddress === null
  )
    return rplRewardClaimerType;

  // We will use the rocket storage contract to get specific smart contract state.
  // If the rocket storage is null and causes an exception, stop indexing because that shouldn't occur.
  let pdaoClaimContractAddress: Address = rocketStorageContract.getAddress(
    generalUtilities.getRocketVaultContractAddressKey(
      ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME
    )
  );

  // #1: Could be the PDAO.
  if (
    pdaoClaimContractAddress !== null &&
    claimingContract.toHexString() == pdaoClaimContractAddress.toHexString()
  ) {
    rplRewardClaimerType = RPLREWARDCLAIMERTYPE_PDAO;
  }

  // #2: Could be a trusted node.
  if (
    rplRewardClaimerType == null &&
    getIsTrustedNode(rocketStorageContract, claimingAddress)
  ) {
    rplRewardClaimerType = RPLREWARDCLAIMERTYPE_TRUSTEDNODE;
  }

  // #3: if the claimer type is still null, it **should** be a regular node.
  if (rplRewardClaimerType == null) {
    // Load the associated regular node.
    let associatedNode = Node.load(claimingAddress.toHexString());
    if (associatedNode !== null) {
      rplRewardClaimerType = RPLREWARDCLAIMERTYPE_NODE;
    }
  }

  return rplRewardClaimerType;
}

/**
 * Update the RPL Claimed Rewark rank for every given node.
 */
function updateRPLClaimedRewardRank(nodeIds: Array<string>): void {
  if (nodeIds === null || nodeIds.length === 0) return;

  let allNodes = new Array<Node>();

  // Loop through all node ids.
  for (let index = 0; index < nodeIds.length; index++) {
    // Determine current node ID.
    let nodeId = <string>nodeIds[index];
    if (nodeId == null) continue;

    // Load the indexed node.
    let node = Node.load(nodeId);
    if (node === null) continue;

    // Keep track of it.
    allNodes.push(<Node>node);
  }

  // If we found any indexed nodes
  if (allNodes.length > 0) {
    // Sort the nodes by the total RPL rewards claimed DESC, time registered ASC.
    let sortedNodesByRPLRewardsClaimedRankAndTimeRegistered = allNodes.sort(function (a, b) {
      if(b.totalClaimedRPLRewards == a.totalClaimedRPLRewards) return a.block.minus(b.block).toI32();
      return b.totalClaimedRPLRewards.minus(a.totalClaimedRPLRewards).toI32();
    });

    // Set the rank of each node based on how much RPL rewards they've claimed.
    let rankIndex = 1;
    for (let index = 0; index < sortedNodesByRPLRewardsClaimedRankAndTimeRegistered.length; index++) {
      // Get the current node for this iteration.
      let currentNode = sortedNodesByRPLRewardsClaimedRankAndTimeRegistered[index];
      if (currentNode === null) continue;

      // The rank of the node in this checkpoint is the current rank index.
      currentNode.totalRPLClaimedRewardsRank = BigInt.fromI32(rankIndex);
      currentNode.save();

      // Increment rank index for next node.
      rankIndex = rankIndex + 1;
    }
  }
}