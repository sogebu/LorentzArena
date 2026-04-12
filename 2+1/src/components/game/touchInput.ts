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
  /** Heading delta accumulated since last consumption (radians). Positive = left (CCW). */
  yawDelta: number;
  /** Pitch delta accumulated since last consumption (radians). Positive = up. */
  pitchDelta: number;
  /** Thrust value: positive = forward, negative = backward. Range [-1, 1]. */
  thrust: number;
  /** Whether fire is active (double-tap held). */
  firing: boolean;
};

const DOUBLE_TAP_INTERVAL = 300; // ms between taps to count as double-tap
const DOUBLE_TAP_DISTANCE = 30; // px max distance between taps
const SWIPE_SENSITIVITY_X = 0.008; // radians per pixel of horizontal movement
const THRUST_SENSITIVITY_Y = 0.015; // thrust per pixel of vertical displacement

/** Find a specific touch by identifier in a TouchList, or null. */
const findTouch = (touches: TouchList, id: number): Touch | null => {
  for (let i = 0; i < touches.length; i++) {
    if (touches[i].identifier === id) return touches[i];
  }
  return null;
};

/** Whether the target element is an interactive UI element (buttons, inputs, etc.) */
const isInteractiveElement = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return !!(
    target.closest("button") ||
    target.closest("input") ||
    target.closest("label") ||
    target.closest("select") ||
    target.closest("details")
  );
};

export const useTouchInput = (): React.RefObject<TouchInputState> => {
  const stateRef = useRef<TouchInputState>({
    yawDelta: 0,
    pitchDelta: 0,
    thrust: 0,
    firing: false,
  });

  const touchRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    startTime: number;
  } | null>(null);

  const lastTapRef = useRef<{ x: number; y: number; time: number } | null>(
    null,
  );

  useEffect(() => {
    const state = stateRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      if (isInteractiveElement(e.target)) return;
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
        state.firing = true;
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
      const active = touchRef.current;
      if (!active) return;
      e.preventDefault();

      const touch = findTouch(e.changedTouches, active.id);
      if (!touch) return;

      // Heading: horizontal movement delta (accumulated between game loop ticks)
      state.yawDelta += -(touch.clientX - active.lastX) * SWIPE_SENSITIVITY_X;
      // Pitch: vertical movement delta (used for camera pitch when dead)
      state.pitchDelta += -(touch.clientY - active.lastY) * SWIPE_SENSITIVITY_X;

      // Thrust: vertical displacement from touch origin (position-based)
      // Up = negative clientY delta = forward thrust (positive)
      const dy = touch.clientY - active.startY;
      state.thrust = Math.max(-1, Math.min(1, -dy * THRUST_SENSITIVITY_Y));

      active.lastX = touch.clientX;
      active.lastY = touch.clientY;
    };

    const handleTouchEnd = (e: TouchEvent) => {
      const active = touchRef.current;
      if (!active) return;
      if (!findTouch(e.changedTouches, active.id)) return;
      e.preventDefault();

      const now = Date.now();

      // Record tap for double-tap detection (only short, non-firing touches)
      if (!state.firing && now - active.startTime < 300) {
        lastTapRef.current = {
          x: active.startX,
          y: active.startY,
          time: now,
        };
      }

      // Reset all state
      touchRef.current = null;
      state.yawDelta = 0;
      state.pitchDelta = 0;
      state.thrust = 0;
      state.firing = false;
    };

    document.addEventListener("touchstart", handleTouchStart, {
      passive: false,
    });
    document.addEventListener("touchmove", handleTouchMove, {
      passive: false,
    });
    document.addEventListener("touchend", handleTouchEnd, { passive: false });
    document.addEventListener("touchcancel", handleTouchEnd, {
      passive: false,
    });

    return () => {
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleTouchEnd);
      document.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  return stateRef;
};
