import React, { useState, useEffect } from "react";
import { Box, Text, useInput, useApp } from "ink";
import { listSkills, type Skill } from "@/tools/skills.js";
import { PAKALON_GOLD, TEXT_SECONDARY } from "@/constants/colors.js";
import logger from "@/utils/logger.js";

interface SkillsScreenProps {
  onSelect?: (skill: Skill) => void;
  onBack?: () => void;
  projectDir?: string;
  onLoadingChange?: (loading: boolean) => void;
}

const SkillsScreen: React.FC<SkillsScreenProps> = ({ onSelect, onBack, projectDir, onLoadingChange }) => {
  const { exit } = useApp();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");

useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let loadError: string | null = null;
      try {
        const discovered = listSkills(projectDir);

        let bundled: Skill[] = [];
        try {
          const bundledInitModule = await import("@/skills/bundled/index.js");
          if (typeof bundledInitModule.initBundledSkills === "function") {
            bundledInitModule.initBundledSkills();
          }
          const bundledModule = await import("@/skills/bundledSkills.js");
          if (typeof bundledModule.getBundledSkills === "function") {
            const bundledSkillsList = bundledModule.getBundledSkills();
            if (Array.isArray(bundledSkillsList)) {
              bundled = bundledSkillsList.map((cmd: { name?: string; aliases?: string[]; description?: string }) => ({
                name: cmd.name ?? cmd.aliases?.[0] ?? "unknown",
                description: cmd.description ?? "",
                content: undefined,
                source: "embedded" as const,
                path: "",
              }));
            }
          }
        } catch (e) {
          logger.warn(`[skills] Failed to load bundled skills: ${e}`);
        }

        let vendored: Skill[] = [];
        try {
          const importerModule = await import("@/skills/importer.js");
          if (typeof importerModule.listImportableVendoredSkills === "function") {
            const vendoredEntries = importerModule.listImportableVendoredSkills();
            if (Array.isArray(vendoredEntries)) {
              vendored = vendoredEntries.map((entry: { name: string; description: string; path: string }) => ({
                name: entry.name,
                description: entry.description ?? "",
                content: undefined,
                source: "vendored" as const,
                path: entry.path ?? "",
              }));
            }
          }
        } catch (e) {
          logger.warn(`[skills] Failed to load vendored skills: ${e}`);
        }

        const combined = [...discovered, ...bundled, ...vendored];
        const seen = new Set<string>();
        const deduped = combined.filter((s) => {
          if (seen.has(s.name)) return false;
          seen.add(s.name);
          return true;
        });

        if (!cancelled) {
          setSkills(deduped);
          if (loadError) {
            setStatusMsg(`Loaded with warnings: ${loadError}`);
          }
        }
      } catch (e) {
        if (!cancelled) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          setStatusMsg(`Error loading skills: ${errorMsg}`);
          setSkills([]);
        }
      }
      if (!cancelled) setLoading(false);
    };
    void load();
    return () => { cancelled = true; };
  }, [projectDir]);

  useEffect(() => {
    onLoadingChange?.(loading);
  }, [loading, onLoadingChange]);

  const filtered = skills.filter((s) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      s.name.toLowerCase().includes(q) ||
      (s.description ?? "").toLowerCase().includes(q)
    );
  });

  useEffect(() => {
    setSelectedIdx((current) => Math.max(0, Math.min(current, Math.max(filtered.length - 1, 0))));
  }, [filtered.length]);

  useInput((input, key) => {
    if (confirmed) return;

    if (key.upArrow) {
      setSelectedIdx((i) => Math.max(0, i - 1));
    } else if (key.downArrow) {
      setSelectedIdx((i) => Math.min(filtered.length - 1, i + 1));
    } else if (key.return && filtered.length > 0) {
      const skill = filtered[selectedIdx];
      if (!skill) return;

      setConfirmed(true);
      setStatusMsg(`[OK] Skill selected: ${skill.name}`);

      if (onSelect) {
        onSelect(skill);
      } else {
        setTimeout(() => exit(), 800);
      }
    } else if (key.escape || (key.ctrl && input === "c")) {
      if (onBack) onBack();
      else exit();
    } else if (key.backspace || key.delete) {
      setQuery((q) => q.slice(0, -1));
    } else if (input && input.length === 1 && !key.ctrl && !key.meta) {
      setQuery((q) => q + input);
    }
  });

  const VIEWPORT = 20;
  const viewStart = Math.max(0, Math.min(selectedIdx - Math.floor(VIEWPORT / 2), filtered.length - VIEWPORT));
  const viewEnd = Math.min(filtered.length, viewStart + VIEWPORT);
  const visibleSkills = filtered.slice(viewStart, viewEnd);

  if (loading) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={PAKALON_GOLD} paddingX={1}>
        <Text color={PAKALON_GOLD}>Loading skills...</Text>
      </Box>
    );
  }

  if (confirmed && statusMsg) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="white" bold>{statusMsg}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={PAKALON_GOLD} paddingX={1} paddingY={0}>
      <Box flexDirection="row" marginBottom={0}>
        <Text bold color={PAKALON_GOLD}>SKILLS</Text>
        <Text dimColor>  {filtered.length} available</Text>
      </Box>

      <Box paddingX={1} marginBottom={0}>
        <Text color={PAKALON_GOLD}>Search: </Text>
        <Text color="white">{query}</Text>
        <Text color={TEXT_SECONDARY}>█</Text>
      </Box>

      <Box flexDirection="column">
        {visibleSkills.map((skill, i) => {
          const isSelected = viewStart + i === selectedIdx;
          const sourceLabel = `[${skill.source.toUpperCase().slice(0, 4)}]`;
          return (
            <Box key={skill.name} flexDirection="row">
              <Text color={isSelected ? "white" : "gray"}>
                {isSelected ? "-> " : "  "}
              </Text>
              <Text color={isSelected ? PAKALON_GOLD : "white"} bold={isSelected}>
                {skill.name.padEnd(25)}
              </Text>
              <Text color={TEXT_SECONDARY}>{sourceLabel} </Text>
              <Text dimColor={!isSelected}>
                {(skill.description ?? "").slice(0, 40)}
              </Text>
            </Box>
          );
        })}
        {filtered.length === 0 && (
          <Box paddingX={2}>
            <Text dimColor>No skills found. Add skills to ~/.agents/skills/ or .pakalon/skills/</Text>
          </Box>
        )}
      </Box>

      {filtered.length > VIEWPORT && (
        <Box paddingX={1}>
          <Text dimColor>{viewStart + 1}–{viewEnd} of {filtered.length}</Text>
        </Box>
      )}

      <Box flexDirection="row" borderStyle="single" borderColor={PAKALON_GOLD} paddingX={1} marginTop={0}>
        <Text dimColor>↑↓</Text>
        <Text> navigate  </Text>
        <Text dimColor>Enter</Text>
        <Text> select  </Text>
        <Text dimColor>type</Text>
        <Text> search  </Text>
        <Text dimColor>Esc</Text>
        <Text> back</Text>
      </Box>
    </Box>
  );
};

export default SkillsScreen;
