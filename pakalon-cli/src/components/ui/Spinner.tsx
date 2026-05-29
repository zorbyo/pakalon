import React from "react";
import { Box, Text } from "ink";
import { PAKALON_GOLD } from "@/constants/colors.js";
import { isScreenReaderMode } from "@/utils/screen-reader.js";
import BlinkingIndicator, { type BlinkingIndicatorVariant } from "@/components/BlinkingIndicator.js";

interface SpinnerProps {
  label?: string;
  variant?: BlinkingIndicatorVariant | "ascii";
  elapsed?: number | string;
}

const Spinner: React.FC<SpinnerProps> = ({ label, variant = "spinner", elapsed }) => {
  if (isScreenReaderMode()) {
    return (
      <Text>
        <Text color={PAKALON_GOLD}>[working] </Text>
        {label && <Text>{label}</Text>}
      </Text>
    );
  }

  const normalizedVariant: BlinkingIndicatorVariant =
    variant === "ascii" ? "spinner" : variant;

  return (
    <Box alignItems="center">
      <BlinkingIndicator
        label={label}
        status="running"
        variant={normalizedVariant}
        elapsed={elapsed}
      />
    </Box>
  );
};

export default React.memo(Spinner);
