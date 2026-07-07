import type { Connection } from "@xyflow/svelte";
import {
	BranchType as BranchKinds,
	type BranchType,
	EDGE_KIND,
	type EdgeStatus,
} from "@/design-system/patterns/CampaignFlow/types/edges";
import type {
	FlowEdge,
	FlowNode,
} from "@/design-system/patterns/CampaignFlow/types/flow";
import type {
	AIActionNodeData,
	EventNodeData,
	FlowNodeData,
	LogicNodeData,
} from "@/design-system/patterns/CampaignFlow/types/nodes";

function getNode(
	nodes: readonly FlowNode[],
	nodeId: string | null | undefined,
) {
	if (!nodeId) return null;
	return nodes.find((node) => node.id === nodeId) ?? null;
}

function getNodeKind(node: FlowNode | null): FlowNodeData["kind"] | null {
	if (!node) return null;
	const data = node.data as FlowNodeData;
	return data.kind;
}

function isFlowHandle(handleId: string | null | undefined) {
	return Boolean(
		handleId?.endsWith("-flow-out") || handleId?.endsWith("-flow-in"),
	);
}

function isSubHandle(handleId: string | null | undefined) {
	return Boolean(handleId?.endsWith("-sub-out") || handleId?.endsWith("-in"));
}

export function isConnectionAllowed(
	connection: Connection,
	nodes: readonly FlowNode[],
) {
	const sourceNode = getNode(nodes, connection.source);
	const targetNode = getNode(nodes, connection.target);

	if (!sourceNode || !targetNode || !connection.source || !connection.target) {
		return false;
	}

	const sourceKind = getNodeKind(sourceNode);
	const targetKind = getNodeKind(targetNode);

	if (!sourceKind || !targetKind) {
		return false;
	}

	if (sourceKind === "channel" && targetKind === "channel") {
		return (
			isFlowHandle(connection.sourceHandle) &&
			isFlowHandle(connection.targetHandle)
		);
	}

	if (
		sourceKind === "channel" &&
		(targetKind === "logic" ||
			targetKind === "event" ||
			targetKind === "ai-action")
	) {
		return (
			isSubHandle(connection.sourceHandle) &&
			isSubHandle(connection.targetHandle)
		);
	}

	if (sourceKind === "logic") {
		return Boolean(
			connection.sourceHandle?.endsWith("-true-out") ||
				connection.sourceHandle?.endsWith("-false-out") ||
				connection.sourceHandle?.endsWith("-out"),
		);
	}

	return false;
}

function deriveConditionalBranch(
	sourceHandle: string | null | undefined,
): BranchType {
	if (sourceHandle?.endsWith("-true-out")) {
		return BranchKinds.TRUE;
	}
	if (sourceHandle?.endsWith("-false-out")) {
		return BranchKinds.FALSE;
	}
	return BranchKinds.TRUE;
}

function createEdgeId(connection: Connection) {
	return [
		connection.source,
		connection.sourceHandle ?? "source",
		connection.target,
		connection.targetHandle ?? "target",
	].join("__");
}

export function hasMatchingEdge(
	connection: Connection,
	edges: readonly FlowEdge[],
) {
	const nextId = createEdgeId(connection);
	return edges.some(
		(edge) =>
			edge.id === nextId ||
			(edge.source === connection.source &&
				edge.target === connection.target &&
				edge.sourceHandle === (connection.sourceHandle ?? undefined) &&
				edge.targetHandle === (connection.targetHandle ?? undefined)),
	);
}

export function buildEdgeFromConnection(
	connection: Connection,
	nodes: readonly FlowNode[],
): FlowEdge | null {
	if (
		!isConnectionAllowed(connection, nodes) ||
		!connection.source ||
		!connection.target
	) {
		return null;
	}

	const sourceNode = getNode(nodes, connection.source);
	const targetNode = getNode(nodes, connection.target);
	const sourceKind = getNodeKind(sourceNode);
	const targetKind = getNodeKind(targetNode);

	if (!sourceNode || !targetNode || !sourceKind || !targetKind) {
		return null;
	}

	const baseEdge = {
		id: createEdgeId(connection),
		source: connection.source,
		target: connection.target,
		sourceHandle: connection.sourceHandle ?? undefined,
		targetHandle: connection.targetHandle ?? undefined,
	} satisfies Pick<
		FlowEdge,
		"id" | "source" | "target" | "sourceHandle" | "targetHandle"
	>;

	const status: EdgeStatus = "idle";

	if (sourceKind === "channel" && targetKind === "channel") {
		return {
			...baseEdge,
			type: EDGE_KIND.FLOW,
			data: {
				kind: "flow",
				status,
				label: "Flow",
			},
		};
	}

	if (sourceKind === "channel" && targetKind === "logic") {
		const targetData = targetNode.data as LogicNodeData;
		return {
			...baseEdge,
			type: EDGE_KIND.LOGIC_HOOK,
			data: {
				kind: "logic-hook",
				status,
				logicType: targetData.logicType,
				label: targetData.label,
			},
		};
	}

	if (sourceKind === "channel" && targetKind === "event") {
		const targetData = targetNode.data as EventNodeData;
		return {
			...baseEdge,
			type: EDGE_KIND.EVENT_TRIGGER,
			data: {
				kind: "event-trigger",
				status,
				eventType: targetData.eventType,
				label: targetData.label,
			},
		};
	}

	if (sourceKind === "channel" && targetKind === "ai-action") {
		const targetData = targetNode.data as AIActionNodeData;
		return {
			...baseEdge,
			type: EDGE_KIND.AI_ACTION,
			data: {
				kind: "ai-action",
				status,
				aiType: targetData.aiType,
				label: targetData.label,
			},
		};
	}

	if (sourceKind === "logic") {
		return {
			...baseEdge,
			type: EDGE_KIND.CONDITIONAL_BRANCH,
			data: {
				kind: "conditional-branch",
				status,
				branch: deriveConditionalBranch(connection.sourceHandle),
				label: "Branch",
			},
		};
	}

	return null;
}
