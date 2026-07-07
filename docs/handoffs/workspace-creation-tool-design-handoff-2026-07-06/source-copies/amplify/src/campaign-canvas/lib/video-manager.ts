let maxConcurrent = 3;
const activeVideos = new Map<string, HTMLVideoElement>();
const loadOrder: string[] = [];

function enforceLimit(): void {
	while (activeVideos.size > maxConcurrent && loadOrder.length > 0) {
		const oldestId = loadOrder.shift();
		if (oldestId) {
			unloadVideo(oldestId);
		}
	}
}

export function loadVideo(
	nodeId: string,
	src: string,
	container: HTMLElement,
): HTMLVideoElement {
	const existing = activeVideos.get(nodeId);
	if (existing) {
		existing.src = src;
		return existing;
	}

	const video = document.createElement("video");
	video.src = src;
	video.muted = true;
	video.playsInline = true;
	video.loop = true;
	video.className = "h-full w-full object-cover";
	video.setAttribute("preload", "metadata");

	container.appendChild(video);
	activeVideos.set(nodeId, video);
	loadOrder.push(nodeId);

	enforceLimit();

	return video;
}

export function unloadVideo(nodeId: string): void {
	const video = activeVideos.get(nodeId);
	if (!video) return;

	video.pause();
	video.src = "";
	video.load();
	video.remove();
	activeVideos.delete(nodeId);

	const idx = loadOrder.indexOf(nodeId);
	if (idx !== -1) loadOrder.splice(idx, 1);
}

export function playVideo(nodeId: string): void {
	const video = activeVideos.get(nodeId);
	if (video) void video.play();
}

export function pauseVideo(nodeId: string): void {
	const video = activeVideos.get(nodeId);
	if (video) video.pause();
}

export function isVideoLoaded(nodeId: string): boolean {
	return activeVideos.has(nodeId);
}

/**
 * Observes a container element and auto-unloads video when it leaves viewport.
 * Returns a cleanup function.
 */
export function observeVideoVisibility(
	nodeId: string,
	element: HTMLElement,
): () => void {
	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) {
					unloadVideo(nodeId);
				}
			}
		},
		{ threshold: 0 },
	);

	observer.observe(element);
	return () => observer.disconnect();
}

export function getActiveVideoCount(): number {
	return activeVideos.size;
}

export function setMaxConcurrent(max: number): void {
	maxConcurrent = Math.max(1, max);
	enforceLimit();
}
