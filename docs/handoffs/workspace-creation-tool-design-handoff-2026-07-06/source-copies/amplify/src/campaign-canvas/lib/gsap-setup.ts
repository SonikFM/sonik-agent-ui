/**
 * Registers GSAP plugins used by the campaign canvas (Flip, Inertia, Pixi, ScrollSmoother,
 * ScrollTrigger) and re-exports them with the default `gsap` instance.
 */
import gsap from "gsap";
import { Draggable } from "gsap/Draggable";
import { Flip } from "gsap/Flip";
import { InertiaPlugin } from "gsap/InertiaPlugin";
import { PixiPlugin } from "gsap/PixiPlugin";
import { ScrollSmoother } from "gsap/ScrollSmoother";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(
	Draggable,
	Flip,
	InertiaPlugin,
	PixiPlugin,
	ScrollSmoother,
	ScrollTrigger,
);

export {
	Draggable,
	Flip,
	gsap,
	InertiaPlugin,
	PixiPlugin,
	ScrollSmoother,
	ScrollTrigger,
};
