import {BigInt, Address} from "@graphprotocol/graph-ts";
import {rocketRewardsPool, RPLTokensClaimed} from "../../generated/rocketRewardsPool/rocketRewardsPool";
import {rocketDAONodeTrusted} from "../../generated/rocketRewardsPool/rocketDAONodeTrusted";
import {rocketNetworkPrices} from "../../generated/rocketRewardsPool/rocketNetworkprices";
import {RPLRewardInterval, Node} from "../../generated/schema";
import {generalUtilities} from "../utilities/generalutilities";
import {rocketPoolEntityFactory} from "../entityfactory";
import {ONE_ETHER_IN_WEI, ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX} from "../constants/generalconstants";
import {
  ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS,
  ROCKET_DAO_NODE_TRUSTED_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_ADDRESS,
  ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_NODE_REWARD_CLAIM_CONTRACT_NAME,
  ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_ADDRESS,
} from "../constants/contractconstants";
import {RPLREWARDCLAIMERTYPE_PDAO, RPLREWARDCLAIMERTYPE_ODAO, RPLREWARDCLAIMERTYPE_NODE} from "../constants/enumconstants";

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
  if (protocol === null) return;

  // We will need the rocketvault smart contract state to get specific addresses.
  // We will need the rocket rewards pool contract to get its smart contract state.
  let rocketRewardPoolContract = rocketRewardsPool.bind(event.address);

  // We need to retrieve the last RPL rewards interval so we can compare it to the current state in the smart contracts.
  let activeIndexedRewardInterval: RPLRewardInterval | null = null;
  let lastRPLRewardIntervalId = protocol.lastRPLRewardInterval;
  if (lastRPLRewardIntervalId != null) {
    activeIndexedRewardInterval = RPLRewardInterval.load(<string>lastRPLRewardIntervalId);
  }

  // Determine claimer type based on the claiming contract and/or claiming address.
  let rplRewardClaimerType: string | null = getRplRewardClaimerType(event.params.claimingContract, event.params.claimingAddress);

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
    activeIndexedRewardInterval.intervalStartTime != smartContractCurrentRewardIntervalStartTime
  ) {
    // If there was an indexed RPL Reward interval which has a different start time then the interval in the smart contracts.
    if (activeIndexedRewardInterval !== null) {
      // We need to close our indexed RPL Rewards interval.
      activeIndexedRewardInterval.intervalClosedTime = event.block.timestamp;
      activeIndexedRewardInterval.isClosed = true;
      let intervalDurationActual = event.block.timestamp.minus(activeIndexedRewardInterval.intervalStartTime);
      if (intervalDurationActual.lt(BigInt.fromI32(0))) {
        intervalDurationActual = activeIndexedRewardInterval.intervalDuration;
      }
      activeIndexedRewardInterval.intervalDurationActual = intervalDurationActual;
      previousActiveIndexedRewardInterval = activeIndexedRewardInterval;
      previousActiveIndexedRewardIntervalId = previousActiveIndexedRewardInterval.id;
    }

    // Create a new RPL Reward interval so we can add this first claim to it.
    activeIndexedRewardInterval = rocketPoolEntityFactory.createRPLRewardInterval(
      ROCKETPOOL_RPL_REWARD_INTERVAL_ID_PREFIX + generalUtilities.extractIdForEntity(event),
      previousActiveIndexedRewardIntervalId,
      rocketRewardPoolContract.getClaimIntervalRewardsTotal(),
      getClaimingContractAllowance(RPLREWARDCLAIMERTYPE_PDAO, event.address),
      getClaimingContractAllowance(RPLREWARDCLAIMERTYPE_ODAO, event.address),
      getClaimingContractAllowance(RPLREWARDCLAIMERTYPE_NODE, event.address),
      previousActiveIndexedRewardInterval !== null && previousActiveIndexedRewardInterval.claimableRewards > BigInt.fromI32(0)
        ? previousActiveIndexedRewardInterval.claimableRewards.minus(previousActiveIndexedRewardInterval.totalRPLClaimed)
        : BigInt.fromI32(0),
      smartContractCurrentRewardIntervalStartTime,
      rocketRewardPoolContract.getClaimIntervalTime(),
      event.block.number,
      event.block.timestamp
    );
    if (activeIndexedRewardInterval === null) return;
    protocol.lastRPLRewardInterval = activeIndexedRewardInterval.id;

    if (previousActiveIndexedRewardInterval !== null) {
      previousActiveIndexedRewardInterval.nextIntervalId = activeIndexedRewardInterval.id;
    }
  }
  if (activeIndexedRewardInterval === null) return;

  // We need this to determine the current RPL/ETH price based on the smart contracts.
  // If for some reason this fails, something is horribly wrong and we need to stop indexing.
  let networkPricesContract = rocketNetworkPrices.bind(Address.fromString(ROCKET_NETWORK_PRICES_CONTRACT_ADDRESS));
  let rplETHExchangeRate = networkPricesContract.getRPLPrice();
  let rplRewardETHAmount = BigInt.fromI32(0);
  if (rplETHExchangeRate > BigInt.fromI32(0)) {
    rplRewardETHAmount = event.params.amount.times(rplETHExchangeRate).div(ONE_ETHER_IN_WEI);
  }

  // Create a new reward claim.
  let rplRewardClaim = rocketPoolEntityFactory.createRPLRewardClaim(
    generalUtilities.extractIdForEntity(event),
    activeIndexedRewardInterval.id,
    event.params.claimingAddress.toHexString(),
    <string>rplRewardClaimerType,
    event.params.amount,
    rplRewardETHAmount,
    event.transaction.hash.toHexString(),
    event.block.number,
    event.block.timestamp
  );
  if (rplRewardClaim === null) return;

  // If the claimer was a node..
  let associatedNode = Node.load(event.params.claimingAddress.toHexString());
  if (associatedNode !== null && (rplRewardClaimerType == RPLREWARDCLAIMERTYPE_ODAO || rplRewardClaimerType == RPLREWARDCLAIMERTYPE_NODE)) {
    // Depending on if the node is an oracle node..
    if (rplRewardClaimerType == RPLREWARDCLAIMERTYPE_ODAO) {
      // Update state for node & this ODAO reward claim.
      associatedNode.totalODAORewardsClaimed = associatedNode.totalODAORewardsClaimed.plus(event.params.amount);
      associatedNode.odaoRewardClaimCount = associatedNode.odaoRewardClaimCount.plus(BigInt.fromI32(1));
      associatedNode.averageODAORewardClaim = associatedNode.totalODAORewardsClaimed.div(associatedNode.odaoRewardClaimCount);

      // Update state for active interval & this ODAO reward claim.
      activeIndexedRewardInterval.totalODAORewardsClaimed = activeIndexedRewardInterval.totalODAORewardsClaimed.plus(event.params.amount);
      activeIndexedRewardInterval.odaoRewardClaimCount = activeIndexedRewardInterval.odaoRewardClaimCount.plus(BigInt.fromI32(1));
    } else {
      // Update state for node & this regular reward claim.
      associatedNode.totalNodeRewardsClaimed = associatedNode.totalNodeRewardsClaimed.plus(event.params.amount);
      associatedNode.nodeRewardClaimCount = associatedNode.nodeRewardClaimCount.plus(BigInt.fromI32(1));
      associatedNode.averageNodeRewardClaim = associatedNode.totalNodeRewardsClaimed.div(associatedNode.nodeRewardClaimCount);

      // Update state for active interval & this regular reward claim.
      activeIndexedRewardInterval.totalNodeRewardsClaimed = activeIndexedRewardInterval.totalNodeRewardsClaimed.plus(event.params.amount);
      activeIndexedRewardInterval.nodeRewardClaimCount = activeIndexedRewardInterval.nodeRewardClaimCount.plus(BigInt.fromI32(1));
    }
  } else if (rplRewardClaimerType == RPLREWARDCLAIMERTYPE_PDAO) {
    // If the claim was made by the PDAO, increment the total on the active interval.
    activeIndexedRewardInterval.totalPDAORewardsClaimed = activeIndexedRewardInterval.totalPDAORewardsClaimed.plus(event.params.amount);
  }

  // Update the grand total claimed of the current interval.
  activeIndexedRewardInterval.totalRPLClaimed = activeIndexedRewardInterval.totalRPLClaimed.plus(rplRewardClaim.amount);

  // Update the averages claimed of the current interval per contract type.
  if (
    activeIndexedRewardInterval.totalODAORewardsClaimed > BigInt.fromI32(0) &&
    activeIndexedRewardInterval.odaoRewardClaimCount > BigInt.fromI32(0)
  ) {
    activeIndexedRewardInterval.averageODAORewardClaim = activeIndexedRewardInterval.totalODAORewardsClaimed.div(
      activeIndexedRewardInterval.odaoRewardClaimCount
    );
  }

  if (
    activeIndexedRewardInterval.totalNodeRewardsClaimed > BigInt.fromI32(0) &&
    activeIndexedRewardInterval.nodeRewardClaimCount > BigInt.fromI32(0)
  ) {
    activeIndexedRewardInterval.averageNodeRewardClaim = activeIndexedRewardInterval.totalNodeRewardsClaimed.div(
      activeIndexedRewardInterval.nodeRewardClaimCount
    );
  }

  // Add this reward claim to the current interval
  let currentRPLRewardClaims = activeIndexedRewardInterval.rplRewardClaims;
  currentRPLRewardClaims.push(rplRewardClaim.id);
  activeIndexedRewardInterval.rplRewardClaims = currentRPLRewardClaims;

  // Index changes to the (new/previous) interval and claim.
  rplRewardClaim.save();
  if (associatedNode !== null) associatedNode.save();
  if (previousActiveIndexedRewardInterval !== null) previousActiveIndexedRewardInterval.save();
  activeIndexedRewardInterval.save();

  // Index the protocol changes.
  protocol.save();
}

/**
 * Checks if the given address is actually a oracle node.
 */
function getIsOracleNode(address: Address): boolean {
  let isOracleNode: boolean = false;

  let rocketDaoNodeTrustedContract = rocketDAONodeTrusted.bind(Address.fromString(ROCKET_DAO_NODE_TRUSTED_CONTRACT_ADDRESS));
  isOracleNode = rocketDaoNodeTrustedContract !== null && rocketDaoNodeTrustedContract.getMemberIsValid(address);

  return isOracleNode;
}

/**
 * Determine the claimer type for a specific RPL reward claim event.
 */
function getRplRewardClaimerType(claimingContract: Address, claimingAddress: Address): string | null {
  let rplRewardClaimerType: string | null = null;
  if (claimingContract === null || claimingAddress === null) return rplRewardClaimerType;

  // #1: Could be the PDAO.
  if (claimingContract.toHexString() == Address.fromString(ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_ADDRESS).toHexString()) {
    rplRewardClaimerType = RPLREWARDCLAIMERTYPE_PDAO;
  }

  // #2: Could be an oracle node.
  if (claimingContract.toHexString() == Address.fromString(ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_ADDRESS).toHexString()) {
    rplRewardClaimerType = RPLREWARDCLAIMERTYPE_ODAO;
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
 * Gets the current claiming contract allowance for the given RPL reward claim type from the smart contracts.
 */
function getClaimingContractAllowance(rplRewardClaimType: string, rewardsPoolAddress: Address): BigInt {
  let rocketRewardsContract = rocketRewardsPool.bind(rewardsPoolAddress);

  if (rplRewardClaimType == RPLREWARDCLAIMERTYPE_PDAO) {
    return rocketRewardsContract.getClaimingContractAllowance(ROCKET_DAO_PROTOCOL_REWARD_CLAIM_CONTRACT_NAME);
  } else if (rplRewardClaimType == RPLREWARDCLAIMERTYPE_ODAO) {
    return rocketRewardsContract.getClaimingContractAllowance(ROCKET_DAO_TRUSTED_NODE_REWARD_CLAIM_CONTRACT_NAME);
  } else if (rplRewardClaimType == RPLREWARDCLAIMERTYPE_NODE) {
    return rocketRewardsContract.getClaimingContractAllowance(ROCKET_NODE_REWARD_CLAIM_CONTRACT_NAME);
  } else {
    return BigInt.fromI32(0);
  }
}
