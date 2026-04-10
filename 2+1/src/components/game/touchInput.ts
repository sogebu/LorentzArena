import { useEffect, useRef } from "react";

/**
 * Touch input state for mobile controls.
 *
 * Full-screen gesture scheme:
 * - Horizontal swipe → heading (yaw) rotation
 * - Vertical swipe → thrust (forward/backward, continuous)
 * - Double-tap (hold 2nd) → fire (while held, combinable with swipe)
 *
 * Touch origin resets on each new touch, so there's no fixed joystick position.
 */

export type TouchInputState = {
	/** Heading delta per frame (radians). Positive = left (CCW). */
	yawDelta: number;
	/** Thrust value: positive = forward, negative = backward. Range roughly [-1, 1]. */
	thrust: number;
	/** Whether fire is active (double-tap held). */
	firing: boolean;
};

const DOUBLE_TAP_INTERVAL = 300; // ms between taps to count as double-tap
const DOUBLE_TAP_DISTANCE = 30; // px max distance between taps
const SWIPE_SENSITIVITY_X = 0.008; // radians per pixel of horizontal movement
const THRUST_SENSITIVITY_Y = 0.015; // thrust per pixel of vertical displacement
const THRUST_MAX = 1.0;

export const useTouchInput = (): React.RefObject<TouchInputState> => {
	const stateRef = useRef<TouchInputState>({
		yawDelta: 0,
		thrust: 0,
		firing: false,
	});

	// Track active touch
	const touchRef = useRef<{
		id: number;
		startX: number;
		startY: number;
		lastX: number;
		lastY: number;
		startTime: number;
	} | null>(null);

	// Track last tap for double-tap detection
	const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(
		null,
	);

	// Track if currently in double-tap-hold (firing) mode
	const firingRef = useRef(false);

	useEffect(() => {
		const handleTouchStart = (e: TouchEvent) => {
			e.preventDefault();

			// Only track the first touch (single-finger control)
			if (touchRef.current !== null) return;

			const touch = e.changedTouches[0];
			const now = Date.now();

			// Double-tap detection
			const lastTap = lastTapRef.current;
			if (
				lastTap &&
				now - lastTap.time < DOUBLE_TAP_INTERVAL &&
				Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) <
					DOUBLE_TAP_DISTANCE
			) {
				// Double-tap detected → enter firing mode
				firingRef.current = true;
				stateRef.current.firing = true;
				lastTapRef.current = null;
			}

			touchRef.current = {
				id: touch.identifier,
				startX: touch.clientX,
				startY: touch.clientY,
				lastX: touch.clientX,
				lastY: touch.clientY,
				startTime: now,
			};
		};

		const handleTouchMove = (e: TouchEvent) => {
			e.preventDefault();

			const active = touchRef.current;
			if (!active) return;

			// Find the tracked touch
			let touch: Touch | null = null;
			for (let i = 0; i < e.changedTouches.length; i++) {
				if (e.changedTouches[i].identifier === active.id) {
					touch = e.changedTouches[i];
					break;
				}
			}
			if (!touch) return;

			// Heading: horizontal movement delta (frame-to-frame)
			const dx = touch.clientX - active.lastX;
			stateRef.current.yawDelta = -dx * SWIPE_SENSITIVITY_X;

			// Thrust: vertical displacement from touch origin (position-based, not delta)
			const dy = touch.clientY - active.startY;
			// Up = negative clientY delta = forward thrust (positive)
			const rawThrust = -dy * THRUST_SENSITIVITY_Y;
			stateRef.current.thrust = Math.max(
				-THRUST_MAX,
				Math.min(THRUST_MAX, rawThrust),
			);

			active.lastX = touch.clientX;
			active.lastY = touch.clientY;
		};

		const handleTouchEnd = (e: TouchEvent) => {
			e.preventDefault();

			const active = touchRef.current;
			if (!active) return;

			// Check if this is the tracked touch ending
			let found = false;
			for (let i = 0; i < e.changedTouches.length; i++) {
				if (e.changedTouches[i].identifier === active.id) {
					found = true;
					break;
				}
			}
			if (!found) return;

			const now = Date.now();

			// Record tap for double-tap detection (only if it was a short touch)
			if (!firingRef.current && now - active.startTime < 300) {
				lastTapRef.current = {
					x: active.startX,
					y: active.startY,
					time: now,
				};
			}

			// Reset state
			touchRef.current = null;
			stateRef.current.yawDelta = 0;
			stateRef.current.thrust = 0;

			if (firingRef.current) {
				firingRef.current = false;
				stateRef.current.firing = false;
			}
		};

		const handleTouchCancel = (e: TouchEvent) => {
			handleTouchEnd(e);
		};

		// Use the document to capture all touches (including over Canvas)
		document.addEventListener("touchstart", handleTouchStart, {
			passive: false,
		});
		document.addEventListener("touchmove", handleTouchMove, {
			passive: false,
		});
		document.addEventListener("touchend", handleTouchEnd, { passive: false });
		document.addEventListener("touchcancel", handleTouchCancel, {
			passive: false,
		});

		return () => {
			document.removeEventListener("touchstart", handleTouchStart);
			document.removeEventListener("touchmove", handleTouchMove);
			document.removeEventListener("touchend", handleTouchEnd);
			document.removeEventListener("touchcancel", handleTouchCancel);
		};
	}, []);

	return stateRef;
};
