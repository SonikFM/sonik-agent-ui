import React from "react";
import { Device, type DeviceProps } from "@/design-system/foundations/device";

export interface DeviceEmulatorProps extends DeviceProps {}

export const DeviceEmulator = React.forwardRef<
	HTMLDivElement,
	DeviceEmulatorProps
>(function DeviceEmulator(props, ref) {
	return <Device ref={ref} {...props} />;
});

DeviceEmulator.displayName = "DeviceEmulator";

export default DeviceEmulator;
