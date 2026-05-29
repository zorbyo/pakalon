import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";

const MINI_LOGO_FRAMES = [
  [
    "  <>  ",
    " <><><> ",
    "<><><><><>",
    " <><><> ",
    "  <>  ",
  ],
  [
    "  <>  ",
    " <><><> ",
    "<><><><><>",
    " <><><> ",
    "  <>  ",
  ],
  [
    "  <>  ",
    " <><><> ",
    "<><><><><>",
    " <><><> ",
    "  <>  ",
  ],
  [
    "  <>  ",
    " <><><> ",
    "<><><><><>",
    " <><><> ",
    "  <>  ",
  ],
  [
    "  <>  ",
    " <><><> ",
    "<><><><><>",
    " <><><> ",
    "  <>  ",
  ],
];

const MiniLogoAnimation: React.FC = () => {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % MINI_LOGO_FRAMES.length);
    }, 400);
    return () => clearInterval(interval);
  }, []);

  const currentFrame = MINI_LOGO_FRAMES[frame] ?? MINI_LOGO_FRAMES[0]!;

  return (
    <Box flexDirection="column">
      {currentFrame.map((line, i) => (
        <Text key={i} color="white">{line}</Text>
      ))}
    </Box>
  );
};

export default MiniLogoAnimation;
