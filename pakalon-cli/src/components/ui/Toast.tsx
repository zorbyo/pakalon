import React, { useEffect } from "react";
import { Box, Text } from "ink";

interface ToastProps {
  message: string;
  visible: boolean;
  onDismiss: () => void;
  duration?: number;
}

const Toast: React.FC<ToastProps> = ({ message, visible, onDismiss, duration = 2500 }) => {
  useEffect(() => {
    if (visible) {
      const timer = setTimeout(() => {
        onDismiss();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [visible, duration, onDismiss]);

  if (!visible || !message) return null;

  return (
    <Box
      position="absolute"
      bottom={1}
      right={2}
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor="green"
      backgroundColor="black"
    >
      <Text color="green" bold>{message}</Text>
    </Box>
  );
};

export default Toast;
