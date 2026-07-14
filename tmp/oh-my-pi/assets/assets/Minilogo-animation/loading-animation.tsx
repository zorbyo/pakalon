import React, { useEffect, useMemo, useState } from "react";
import { Text } from "ink";

type PlaybackAPI = {
  play: () => void;
  pause: () => void;
  restart: () => void;
};

type LoadingAnimationProps = {
  hasDarkBackground?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  compact?: boolean;
  compactColor?: string;
  onReady?: (api: PlaybackAPI) => void;
};

const FRAMES = ["◜", "◝", "◞", "◟"] as const;

const LoadingAnimationInner: React.FC<LoadingAnimationProps> = ({
  autoPlay = true,
  compactColor = "#E8AA41",
  onReady,
}) => {
  const [playing, setPlaying] = useState(autoPlay);
  const [frameIndex, setFrameIndex] = useState(0);

  const api = useMemo<PlaybackAPI>(() => ({
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    restart: () => {
      setFrameIndex(0);
      setPlaying(true);
    },
  }), []);

  useEffect(() => {
    onReady?.(api);
  }, [api, onReady]);

  useEffect(() => {
    setPlaying(autoPlay);
  }, [autoPlay]);

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % FRAMES.length);
    }, 160);
    return () => clearInterval(timer);
  }, [playing]);

  return <Text color={compactColor}>{FRAMES[frameIndex]}</Text>;
};

const LoadingAnimation = React.memo(LoadingAnimationInner);

export default LoadingAnimation;
