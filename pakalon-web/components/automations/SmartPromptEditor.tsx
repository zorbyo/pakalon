'use client';

import React, { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react';

interface SmartPromptEditorProps {
  value: string;
  onChange: (value: string) => void;
  connectedProviders: string[];
  providerDisplayNames: Record<string, string>;
  fetchResources: (provider: string) => Promise<{ id: string; name: string; type: string }[]>;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

const PROVIDER_COLORS: Record<string, string> = {
  github: 'bg-gradient-to-r from-slate-300 to-slate-500 text-slate-950',
  slack: 'bg-gradient-to-r from-fuchsia-400 to-violet-500 text-white',
  notion: 'bg-gradient-to-r from-zinc-200 to-zinc-400 text-zinc-950',
  default: 'bg-gradient-to-r from-[#d4d6ca] to-[#7a7f67] text-[#11120d]',
};

export function SmartPromptEditor({
  value,
  onChange,
  connectedProviders,
  providerDisplayNames,
  fetchResources,
  placeholder = 'Type your prompt here... Use @ to mention connected providers.',
  disabled = false,
  className = '',
}: SmartPromptEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionIndex, setMentionIndex] = useState(-1);
  const [cursorPosition, setCursorPosition] = useState({ top: 0, left: 0 });
  
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [resources, setResources] = useState<{ id: string; name: string; type: string }[]>([]);
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Extract mentions for chips
  const extractMentions = (text: string) => {
    const regex = /@(\w[\w.-]*)(?:\s+([^\s]+))?/g;
    const mentions = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      const provider = match[1];
      const resource = match[2];
      if (connectedProviders.includes(provider)) {
        mentions.push({ provider, resource });
      }
    }
    return mentions;
  };

  const resolvedMentions = extractMentions(value);

  const filteredProviders = connectedProviders.filter((p) =>
    p.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const filteredResources = resources.filter((r) =>
    r.name.toLowerCase().includes(mentionQuery.toLowerCase())
  );

  const currentOptions = resourceOpen ? filteredResources : filteredProviders;

  useEffect(() => {
    setHighlightedIndex(0);
  }, [mentionQuery, resourceOpen, filteredProviders.length, filteredResources.length]);

  const updateCursorPosition = () => {
    if (!textareaRef.current) return;
    const textarea = textareaRef.current;
    const { selectionStart } = textarea;
    
    // A simple approximation for cursor position
    const textBeforeCursor = textarea.value.substring(0, selectionStart);
    const lines = textBeforeCursor.split('\n');
    const currentLine = lines[lines.length - 1];
    
    // Rough estimation based on character count and line height
    const lineHeight = 24; // approx line height
    const charWidth = 8; // approx char width
    
    setCursorPosition({
      top: lines.length * lineHeight,
      left: currentLine.length * charWidth,
    });
  };

  const handleTextChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    
    const cursor = e.target.selectionStart;
    const textBeforeCursor = newValue.substring(0, cursor);
    
    // Check if we are typing a mention
    const lastAtSymbol = textBeforeCursor.lastIndexOf('@');
    
    if (lastAtSymbol !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtSymbol + 1);
      // If there's a space, we might be typing a resource or we exited the mention
      if (textAfterAt.includes(' ')) {
        const parts = textAfterAt.split(' ');
        if (parts.length === 2 && selectedProvider) {
          // Typing resource
          setMentionQuery(parts[1]);
          setMentionIndex(lastAtSymbol);
          updateCursorPosition();
        } else {
          // Exited mention
          closeDropdowns();
        }
      } else {
        // Typing provider
        setMentionOpen(true);
        setResourceOpen(false);
        setSelectedProvider(null);
        setMentionQuery(textAfterAt);
        setMentionIndex(lastAtSymbol);
        updateCursorPosition();
      }
    } else {
      closeDropdowns();
    }
  };

  const closeDropdowns = () => {
    setMentionOpen(false);
    setResourceOpen(false);
    setSelectedProvider(null);
    setMentionQuery('');
  };

  const handleSelectProvider = async (provider: string) => {
    setSelectedProvider(provider);
    setMentionQuery('');
    setResourceOpen(true);
    setResourcesLoading(true);
    
    // Update text to include provider and space
    const beforeMention = value.substring(0, mentionIndex);
    const afterMention = value.substring(textareaRef.current?.selectionStart || 0);
    const newValue = `${beforeMention}@${provider} ${afterMention}`;
    onChange(newValue);
    
    // Set cursor after the space
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = mentionIndex + provider.length + 2;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);

    try {
      const fetchedResources = await fetchResources(provider);
      setResources(fetchedResources);
    } catch (error) {
      console.error('Failed to fetch resources', error);
      setResources([]);
    } finally {
      setResourcesLoading(false);
    }
  };

  const handleSelectResource = (resourceName: string) => {
    if (!selectedProvider) return;
    
    const beforeMention = value.substring(0, mentionIndex);
    const afterMention = value.substring(textareaRef.current?.selectionStart || 0);
    const newValue = `${beforeMention}@${selectedProvider} ${resourceName} ${afterMention}`;
    onChange(newValue);
    
    closeDropdowns();
    
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursorPos = mentionIndex + selectedProvider.length + resourceName.length + 3;
        textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        textareaRef.current.focus();
      }
    }, 0);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!mentionOpen && !resourceOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.min(prev + 1, currentOptions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((prev) => Math.max(prev - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (currentOptions.length > 0) {
        if (resourceOpen) {
          handleSelectResource((currentOptions[highlightedIndex] as any).name);
        } else {
          handleSelectProvider(currentOptions[highlightedIndex] as string);
        }
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeDropdowns();
    } else if (e.key === 'Tab') {
      closeDropdowns();
    }
  };

  return (
    <div className={`relative flex flex-col gap-2 ${className}`}>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className="w-full min-h-[120px] p-4 bg-background-dark border border-border-dark rounded-xl text-[#d7dac8] focus:outline-none focus:ring-1 focus:ring-primary/50 resize-y font-mono text-sm"
          onClick={updateCursorPosition}
          onKeyUp={updateCursorPosition}
        />

        {(mentionOpen || resourceOpen) && (
          <div 
            className="absolute z-50 w-64 max-h-60 overflow-y-auto bg-surface-dark border border-border-dark rounded-xl shadow-xl py-1"
            style={{ 
              top: `${Math.min(cursorPosition.top + 30, 200)}px`, 
              left: `${Math.min(cursorPosition.left + 16, 300)}px` 
            }}
          >
            {resourceOpen ? (
              <>
                <div className="px-3 py-1 text-xs text-gray-400 border-b border-border-dark/50 mb-1">
                  Resources for {providerDisplayNames[selectedProvider!] || selectedProvider}
                </div>
                {resourcesLoading ? (
                  <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2">
                    <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
                    Loading...
                  </div>
                ) : filteredResources.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">No resources found</div>
                ) : (
                  filteredResources.map((resource, idx) => (
                    <button
                      key={resource.id}
                      className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                        idx === highlightedIndex ? 'bg-white/10 text-white' : 'text-[#d7dac8] hover:bg-white/5'
                      }`}
                      onClick={() => handleSelectResource(resource.name)}
                    >
                      <span className="material-symbols-outlined text-sm opacity-70">
                        {resource.type === 'repo' ? 'book' : resource.type === 'channel' ? 'tag' : 'description'}
                      </span>
                      <span className="truncate">{resource.name}</span>
                    </button>
                  ))
                )}
              </>
            ) : (
              <>
                <div className="px-3 py-1 text-xs text-gray-400 border-b border-border-dark/50 mb-1">
                  Providers
                </div>
                {filteredProviders.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-gray-400">No providers found</div>
                ) : (
                  filteredProviders.map((provider, idx) => {
                    const colorClass = PROVIDER_COLORS[provider] || PROVIDER_COLORS.default;
                    return (
                      <button
                        key={provider}
                        className={`w-full text-left px-4 py-2 text-sm flex items-center gap-2 ${
                          idx === highlightedIndex ? 'bg-white/10 text-white' : 'text-[#d7dac8] hover:bg-white/5'
                        }`}
                        onClick={() => handleSelectProvider(provider)}
                      >
                        <div className={`w-2 h-2 rounded-full ${colorClass.split(' ')[0]}`} />
                        <span>{providerDisplayNames[provider] || provider}</span>
                      </button>
                    );
                  })
                )}
              </>
            )}
          </div>
        )}
      </div>

      {resolvedMentions.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-1">
          {resolvedMentions.map((mention, idx) => {
            const colorClass = PROVIDER_COLORS[mention.provider] || PROVIDER_COLORS.default;
            const displayName = providerDisplayNames[mention.provider] || mention.provider;
            return (
              <div 
                key={`${mention.provider}-${idx}`}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border border-white/10 ${colorClass}`}
              >
                <span className="font-bold">{displayName}</span>
                {mention.resource && (
                  <>
                    <span className="opacity-50">:</span>
                    <span>{mention.resource}</span>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
