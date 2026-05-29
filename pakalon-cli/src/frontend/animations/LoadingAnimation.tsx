import React, { useEffect, useState } from "react";
import { Text } from "ink";
import { PAKALON_GOLD } from "@/constants/colors.js";

type LoadingAnimationProps = {
  autoPlay?: boolean;
  loop?: boolean;
  color?: string;
  intervalMs?: number;
};

const FRAMES = ["", "", "", "", "", "", "", "", "", ""] as const;

const LoadingAnimationInner: React.FC<LoadingAnimationProps> = ({
  autoPlay = true,
  loop = true,
  color = PAKALON_GOLD,
  intervalMs = 120,
}) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoPlay);

  useEffect(() => {
    setIsPlaying(autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    if (!isPlaying) return;

    const timer = setInterval(
      () => {
        setFrameIndex((current) => {
          const next = current + 1;
          if (next < FRAMES.length) return next;
          if (loop) return 0;
          setIsPlaying(false);
          return current;
        });
      },
      Math.max(16, intervalMs),
    );

    return () => clearInterval(timer);
  }, [intervalMs, isPlaying, loop]);

  return <Text color={color}>{FRAMES[frameIndex] ?? FRAMES[0]}</Text>;
};

export const LoadingAnimation = React.memo(LoadingAnimationInner);

export default LoadingAnimation;
