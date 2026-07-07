import type { Meta, StoryObj } from "@storybook/react";
import { DeviceEmulator, type DeviceEmulatorProps } from "./DeviceEmulator";

function DeviceEmulatorStory(props: DeviceEmulatorProps) {
	return <DeviceEmulator {...props} />;
}

const meta: Meta<typeof DeviceEmulatorStory> = {
	title: "Flow/DeviceEmulator",
	component: DeviceEmulatorStory,
	parameters: {
		layout: "fullscreen",
	},
	decorators: [
		(Story: () => JSX.Element) => (
			<div className="flex h-[88vh] w-full items-center justify-center bg-base-200 p-6">
				<Story />
			</div>
		),
	],
	args: {
		scale: 0.78,
		parallaxStrength: 10,
		rotateStrength: 2.2,
		image:
			"https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80",
	},
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Basic: Story = {};

export const ScrollableContent: Story = {
	render: () => (
		<DeviceEmulator
			scale={0.78}
			isScrollable
			autoAnimate={false}
			image="https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=800&q=80"
		>
			<div className="space-y-4 p-4 text-base-content">
				{Array.from({ length: 20 }).map((_, index) => (
					<div
						key={`device-item-${index + 1}`}
						className="rounded-lg border border-base-300 bg-base-100 p-3"
					>
						<p className="text-xs font-semibold text-base-content/70">
							Section {index + 1}
						</p>
						<p className="text-sm">Scrollable emulator content sample</p>
					</div>
				))}
			</div>
		</DeviceEmulator>
	),
};
