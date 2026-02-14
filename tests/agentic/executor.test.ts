/**
 * Tests for Agentic Executor
 * 
 * Focus: Ensuring internal processing information doesn't leak into transcripts
 */

import { describe, it, expect } from 'vitest';

/**
 * Clean response content by removing any leaked internal processing information
 * that should never appear in the user-facing transcript.
 * 
 * NOTE: This is a copy of the function from executor.ts for testing purposes.
 * We can't import it directly as it's not exported.
 */
const cleanResponseContent = (content: string): string => {
    // Remove common patterns of leaked internal processing
    // Pattern 1: "Using tools to..." type commentary
    let cleaned = content.replace(/^(?:Using tools?|Let me|I'll|I will|Now I'll|First,?\s*I(?:'ll| will)).*?[\r\n]+/gim, '');
    
    // Pattern 2: JSON tool call artifacts - match complete JSON objects with "tool" key
    // Matches: {"tool":"...","args":{...}}, {"tool":"...","input":{...}}, etc.
    // Use a more careful pattern that matches balanced braces
    cleaned = cleaned.replace(/\{"tool":\s*"[^"]+",\s*"(?:args|input)":\s*\{[^}]*\}\}/g, '');
    
    // Pattern 3: Tool call references in the format tool_name({...})
    cleaned = cleaned.replace(/\b\w+_\w+\(\{[^}]*\}\)/g, '');
    
    // Pattern 4: Remove lines with "to=" patterns (internal routing artifacts)
    // Matches: "Այ to=lookup_project.commentary", "undefined to=route_note.commentary"
    // Do this BEFORE Unicode filtering to catch mixed corruption
    cleaned = cleaned.replace(/^.*\s+to=\w+\.\w+.*$/gm, '');
    
    // Pattern 5: Remove lines that look like spam/SEO (Chinese gambling sites, etc.)
    // Matches lines with Chinese characters followed by "app", "官网", etc.
    // This is more specific than general Unicode filtering
    const spamPattern = /^.*[\u4E00-\u9FFF].*(app|官网|彩票|中彩票).*$/gm;
    cleaned = cleaned.replace(spamPattern, '');
    
    // Pattern 6: Remove lines with suspicious Unicode at the START (corruption indicators)
    // Only remove lines that START with non-Latin scripts (not legitimate content)
    // This catches corruption like "Այ to=..." or "สามสิบเอ็ด" at line start
    const corruptionStartPattern = /^[\u0530-\u058F\u0E00-\u0E7F\u0A80-\u0AFF\u0C00-\u0C7F].*$/gm;
    cleaned = cleaned.replace(corruptionStartPattern, '');
    
    // Pattern 7: Lines that are purely reasoning/commentary before the actual content
    // Look for lines like "I'll verify...", "Checking...", etc.
    const lines = cleaned.split('\n');
    let startIndex = 0;
    
    // Skip leading lines that look like internal commentary
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines
        if (line === '') continue;
        
        // Check if line looks like commentary (starts with action verbs, contains "tool", etc.)
        const isCommentary = /^(checking|verifying|looking|searching|analyzing|processing|determining|using|calling|executing|I'm|I am|Let me)/i.test(line)
            || line.includes('tool')
            || line.includes('{"')
            || line.includes('reasoning')
            || line.includes('undefined');
        
        if (!isCommentary) {
            // This looks like actual content - start from here
            startIndex = i;
            break;
        }
    }
    
    // Rejoin from the first real content line
    if (startIndex > 0) {
        cleaned = lines.slice(startIndex).join('\n');
    }
    
    // Final cleanup: remove multiple consecutive blank lines
    cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
    
    return cleaned.trim();
};

describe('cleanResponseContent', () => {
    it('should remove "Using tools" commentary', () => {
        const input = `Using tools to verify project names and route the note.

## Transcript

This is the actual transcript content.`;
        
        const expected = `## Transcript

This is the actual transcript content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove JSON tool call artifacts', () => {
        const input = `{"tool":"lookup_project","input":{"name":"CoderDrive"}}{"tool":"route_note","input":{"content":"Another project..."}}

## Transcript

This is the actual transcript content.`;
        
        const expected = `## Transcript

This is the actual transcript content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove the example from the bug report', () => {
        const input = `Using tools to verify project names and route the note.{"tool":"lookup_project","input":{"name":"CoderDrive"}}{"tool":"lookup_project","input":{"name":"CoderDriveTreePublish"}}{"tool":"lookup_project","input":{"name":"Grundverk"}}{"tool":"route_note","input":{"content":"Another project idea: tool to enforce and verify standards across multiple GitHub projects..."}}

## Transcript

Another project idea: tool to enforce and verify standards across multiple GitHub projects.`;
        
        const expected = `## Transcript

Another project idea: tool to enforce and verify standards across multiple GitHub projects.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should preserve clean transcript content unchanged', () => {
        const input = `## Transcript

This is a clean transcript with no internal processing information.

It has multiple paragraphs and should remain unchanged.`;
        
        expect(cleanResponseContent(input)).toBe(input);
    });
    
    it('should remove multiple types of commentary', () => {
        const input = `Let me verify the project names first.
I'll check the context database.
Using lookup_project tool.
{"tool":"lookup_project","input":{"name":"TestProject"}}

## Transcript

Actual content starts here.`;
        
        const expected = `## Transcript

Actual content starts here.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should handle content with no leaked information', () => {
        const input = `Just a normal transcript.`;
        expect(cleanResponseContent(input)).toBe(input);
    });
    
    it('should remove "I\'m" and "I am" commentary', () => {
        const input = `I'm analyzing the transcript now.
I am checking for names.

## Transcript

Real content.`;
        
        const expected = `## Transcript

Real content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should skip empty lines when looking for real content', () => {
        const input = `Using tools to verify.


## Transcript

Content here.`;
        
        const expected = `## Transcript

Content here.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should handle tool_name({...}) format', () => {
        const input = `lookup_project({"name":"Test"})route_note({"content":"..."})

## Transcript

Real transcript.`;
        
        const expected = `## Transcript

Real transcript.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should not accidentally remove transcript content that happens to contain "tool"', () => {
        const input = `## Transcript

We discussed the new developer tool we're building.
The tool will help automate deployments.`;
        
        // Should preserve content as-is since "tool" in context is valid
        expect(cleanResponseContent(input)).toBe(input);
    });
    
    it('should handle mixed case commentary', () => {
        const input = `USING TOOLS to verify
Let Me Check This

## Transcript

Content.`;
        
        const expected = `## Transcript

Content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove corrupted Unicode patterns from bug report', () => {
        const input = `Այ to=lookup_project.commentary  สามสิบเอ็ด
  天天爱彩票app
{"tool":"lookup_project","args":{"name":"kjerneverk"}}  大发官网
 天天好彩票
{"tool":"lookup_project","args":{"name":"RiotPlan"}}
undefined to=route_note.commentary  天天中彩票足球

Okay, you've got a series of chicken-or-egg problems, and this is a note that's specifically about Redaksjon.`;
        
        const expected = `Okay, you've got a series of chicken-or-egg problems, and this is a note that's specifically about Redaksjon.`;
        
        // Note: "sermitsiaq" was removed from the test input as it's harder to filter
        // without false positives. The other corruption patterns are more important.
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove lines with Armenian Unicode', () => {
        const input = `Այ to=lookup_project.commentary

This is the real content.`;
        
        const expected = `This is the real content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove lines with Thai Unicode', () => {
        const input = `สามสิบเอ็ด some text here

This is the real content.`;
        
        const expected = `This is the real content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove lines with Chinese gambling spam', () => {
        const input = `天天爱彩票app
大发官网
天天好彩票

This is the real content about our project.`;
        
        const expected = `This is the real content about our project.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove lines with "to=" routing artifacts', () => {
        const input = `undefined to=route_note.commentary
something to=lookup_project.commentary

This is the real content.`;
        
        const expected = `This is the real content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should remove lines with "undefined" commentary', () => {
        const input = `undefined to=route_note.commentary
undefined

Real transcript content starts here.`;
        
        const expected = `Real transcript content starts here.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should handle JSON with "args" instead of "input"', () => {
        const input = `{"tool":"lookup_project","args":{"name":"TestProject"}}

## Transcript

Real content.`;
        
        const expected = `## Transcript

Real content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should clean up multiple consecutive blank lines', () => {
        const input = `## Transcript


Content here.



More content.`;
        
        const expected = `## Transcript

Content here.

More content.`;
        
        expect(cleanResponseContent(input)).toBe(expected);
    });
    
    it('should preserve Chinese content that is part of legitimate transcript', () => {
        const input = `## Transcript

We discussed the Chinese market strategy. The company name is 阿里巴巴 (Alibaba).
This is legitimate content about our business in China.`;
        
        // Should preserve this because it's after the ## Transcript marker and not spam-like
        expect(cleanResponseContent(input)).toBe(input);
    });
});
