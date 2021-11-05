import { ethereum, BigInt } from "@graphprotocol/graph-ts";
import { NetworkNodeBalanceCheckpoint, Node } from "../../generated/schema";
import { generalUtilities } from "./generalUtilities";
import { NetworkNodeBalanceMinipoolMetadata } from "../models/networkNodeBalanceMinipoolMetadata";
import { ONE_ETHER_IN_WEI } from "../constants/generalconstants";

class NodeUtilities {
  /**
   * Checks if there is already an indexed network node balance checkpoint for the given event.
   */
  public hasNetworkNodeBalanceCheckpointHasBeenIndexed(
    event: ethereum.Event
  ): boolean {
    // Is this transaction already logged?
    return (
      NetworkNodeBalanceCheckpoint.load(
        generalUtilities.extractIdForEntity(event)
      ) !== null
    );
  }

  /**
   * Calculates and returns the minimum RPL a node operator needs as collateral for a minipool.
   */
  public getMinimumRPLForNewMinipool(
    nodeDepositAmount: BigInt,
    minimumEthCollateralRatio: BigInt,
    rplPrice: BigInt
  ): BigInt {
    if (
      nodeDepositAmount == BigInt.fromI32(0) ||
      minimumEthCollateralRatio == BigInt.fromI32(0) ||
      rplPrice == BigInt.fromI32(0)
    )
      return BigInt.fromI32(0);
    return nodeDepositAmount.times(minimumEthCollateralRatio).div(rplPrice);
  }

  /**
   * Calculates and returns the maximum RPL a node operator needs as collateral for a minipool.
   */
  public getMaximumRPLForNewMinipool(
    nodeDepositAmount: BigInt,
    maximumETHCollateralRatio: BigInt,
    rplPrice: BigInt
  ): BigInt {
    if (
      nodeDepositAmount == BigInt.fromI32(0) ||
      maximumETHCollateralRatio == BigInt.fromI32(0) ||
      rplPrice == BigInt.fromI32(0)
    )
      return BigInt.fromI32(0);
    return nodeDepositAmount.times(maximumETHCollateralRatio).div(rplPrice);
  }

  /**
   * Updates the network checkpoint based on the state of the node.
   * E.g. Increment running total (effective) RPL staked for this network checkpoint, ...
   */
  public updateNetworkNodeBalanceCheckpointForNode(
    networkCheckpoint: NetworkNodeBalanceCheckpoint,
    node: Node
  ): void {
    // Update total number of nodes registered.
    networkCheckpoint.nodesRegistered = networkCheckpoint.nodesRegistered.plus(
      BigInt.fromI32(1)
    );

    // Update total (effective) RPL staked.
    networkCheckpoint.rplStaked = networkCheckpoint.rplStaked.plus(
      node.rplStaked
    );
    networkCheckpoint.effectiveRPLStaked = networkCheckpoint.effectiveRPLStaked.plus(
      node.effectiveRPLStaked
    );

    // Update the total ETH RPL Slashed up to this checkpoint.
    networkCheckpoint.totalRPLSlashed = networkCheckpoint.totalRPLSlashed.plus(
      node.totalRPLSlashed
    );

    // Update total RPL rewards claimed up to this checkpoint.
    networkCheckpoint.totalClaimedRPLRewards = networkCheckpoint.totalClaimedRPLRewards.plus(
      node.totalClaimedRPLRewards
    );

    // Update total number of minipools per state.
    networkCheckpoint.queuedMinipools = networkCheckpoint.queuedMinipools.plus(
      node.queuedMinipools
    );
    networkCheckpoint.stakingMinipools = networkCheckpoint.stakingMinipools.plus(
      node.stakingMinipools
    );
    networkCheckpoint.stakingUnbondedMinipools = networkCheckpoint.stakingUnbondedMinipools.plus(
      node.stakingUnbondedMinipools
    );
    networkCheckpoint.withdrawableMinipools = networkCheckpoint.withdrawableMinipools.plus(
      node.withdrawableMinipools
    );
    networkCheckpoint.totalFinalizedMinipools = networkCheckpoint.totalFinalizedMinipools.plus(
      node.totalFinalizedMinipools
    );
  }

  /**
   * Updates the metadata with the relevant state from the node.
   */
  public updateMinipoolMetadataWithNode(
    minipoolMetadata: NetworkNodeBalanceMinipoolMetadata,
    node: Node
  ): void {
    // We need this to calculate the averages on the network level.
    if (node.averageFeeForActiveMinipools > BigInt.fromI32(0)) {
      minipoolMetadata.totalAverageFeeInETHForAllActiveMinipools = minipoolMetadata.totalAverageFeeInETHForAllActiveMinipools.plus(
        node.averageFeeForActiveMinipools.div(ONE_ETHER_IN_WEI)
      );
      minipoolMetadata.totalNodesWithActiveMinipools = minipoolMetadata.totalNodesWithActiveMinipools.plus(
        BigInt.fromI32(1)
      );
    }

    // Update thte total minimum/maximum effective RPL grand total for the current network node balance checkpoint.
    minipoolMetadata.totalMinimumEffectiveRPL =
      minipoolMetadata.totalMinimumEffectiveRPL.plus(node.minimumEffectiveRPL);
    minipoolMetadata.totalMaximumEffectiveRPL =
      minipoolMetadata.totalMaximumEffectiveRPL.plus(node.maximumEffectiveRPL);
  }

  /**
   * Updates the network node balance checkpoint based on the given minipool metadata.
   * E.G. Calculate the average node fee for the active minipools, ...
   */
  public updateNetworkNodeBalanceCheckpointForMinipoolMetadata(
    checkpoint: NetworkNodeBalanceCheckpoint,
    minipoolMetadata: NetworkNodeBalanceMinipoolMetadata
  ): void {
    // Calculate the network fee average for active minipools if possible.
    if (
      minipoolMetadata.totalNodesWithActiveMinipools > BigInt.fromI32(0) &&
      minipoolMetadata.totalAverageFeeInETHForAllActiveMinipools >
      BigInt.fromI32(0)
    ) {
      // Store this in WEI.
      checkpoint.averageFeeForActiveMinipools = minipoolMetadata.totalAverageFeeInETHForAllActiveMinipools
        .div(minipoolMetadata.totalNodesWithActiveMinipools)
        .times(ONE_ETHER_IN_WEI);
    }

    // Calculate total RPL needed to min/max collateralize the staking minipools at this checkpoint.
    checkpoint.minimumEffectiveRPL = minipoolMetadata.totalMinimumEffectiveRPL;
    checkpoint.maximumEffectiveRPL = minipoolMetadata.totalMaximumEffectiveRPL;
  }

  /**
   * If the running totals of the given checkpoint are 0, then we can take it from the previous one.
   */
  public coerceRunningTotalsBasedOnPreviousCheckpoint(
    checkpoint: NetworkNodeBalanceCheckpoint,
    previousCheckpoint: NetworkNodeBalanceCheckpoint | null
  ): void {
    if (previousCheckpoint === null) return;

    // If for some reason our total claimed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
    if (
      checkpoint.totalClaimedRPLRewards == BigInt.fromI32(0) &&
      previousCheckpoint.totalClaimedRPLRewards > BigInt.fromI32(0)
    ) {
      checkpoint.totalClaimedRPLRewards =
        previousCheckpoint.totalClaimedRPLRewards;
    }

    // If for some reason our total slashed RPL rewards up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
    if (
      checkpoint.totalRPLSlashed == BigInt.fromI32(0) &&
      previousCheckpoint.totalRPLSlashed > BigInt.fromI32(0)
    ) {
      checkpoint.totalRPLSlashed = previousCheckpoint.totalRPLSlashed;
    }

    // If for some reason our total finalized minipools up to this checkpoint was 0, then we try to set it based on the previous checkpoint.
    if (
      checkpoint.totalFinalizedMinipools == BigInt.fromI32(0) &&
      previousCheckpoint.totalFinalizedMinipools > BigInt.fromI32(0)
    ) {
      checkpoint.totalFinalizedMinipools =
        previousCheckpoint.totalFinalizedMinipools;
    }
  }
}

export let nodeUtilities = new NodeUtilities();