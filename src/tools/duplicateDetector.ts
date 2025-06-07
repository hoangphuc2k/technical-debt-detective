import { Tool } from "langchain/tools";
import * as crypto from "crypto";

export class DuplicateDetectorTool extends Tool {
  name = "duplicate_detector";
  description =
    "Detects duplicate code blocks and similar patterns in JavaScript/TypeScript code";

  async _call(code: string): Promise<string> {
    const duplicates = this.findDuplicates(code);
    return JSON.stringify(duplicates);
  }

  private findDuplicates(code: string): any {
    const lines = code.split("\n");
    const codeBlocks: Map<
      string,
      Array<{ start: number; end: number }>
    > = new Map();
    const duplicates: any[] = [];
    const minBlockSize = 3; // Minimum lines for a block to be considered

    // Extract and hash code blocks
    for (let i = 0; i < lines.length - minBlockSize; i++) {
      for (
        let blockSize = minBlockSize;
        blockSize <= 10 && i + blockSize <= lines.length;
        blockSize++
      ) {
        const block = lines.slice(i, i + blockSize);
        const normalizedBlock = this.normalizeCodeBlock(block);

        if (this.isSignificantBlock(normalizedBlock)) {
          const hash = this.hashCodeBlock(normalizedBlock);

          if (!codeBlocks.has(hash)) {
            codeBlocks.set(hash, []);
          }

          codeBlocks.get(hash)!.push({
            start: i + 1,
            end: i + blockSize,
          });
        }
      }
    }

    // Find duplicates
    codeBlocks.forEach((locations, hash) => {
      if (locations.length > 1) {
        // Filter out overlapping blocks
        const nonOverlapping = this.filterOverlapping(locations);

        if (nonOverlapping.length > 1) {
          duplicates.push({
            type: "duplicate_code",
            locations: nonOverlapping,
            lines: nonOverlapping[0].end - nonOverlapping[0].start + 1,
            occurrences: nonOverlapping.length,
            severity: this.calculateSeverity(nonOverlapping),
          });
        }
      }
    });

    // Also check for similar patterns (not exact duplicates)
    const patterns = this.detectSimilarPatterns(code);

    return {
      exactDuplicates: duplicates,
      similarPatterns: patterns,
      summary: {
        totalDuplicateBlocks: duplicates.length,
        totalDuplicateLines: duplicates.reduce(
          (sum, d) => sum + d.lines * d.occurrences,
          0
        ),
        mostDuplicatedBlock: duplicates.sort(
          (a, b) => b.occurrences - a.occurrences
        )[0],
      },
    };
  }

  private normalizeCodeBlock(lines: string[]): string[] {
    return lines
      .map(
        (line) =>
          line
            .trim()
            .replace(/\s+/g, " ") // Normalize whitespace
            .replace(/['"`]/g, "") // Remove quotes to catch similar strings
            .replace(/\d+/g, "N") // Replace numbers with N to catch similar patterns
      )
      .filter(
        (line) =>
          line.length > 0 &&
          !line.startsWith("//") &&
          !line.startsWith("*") &&
          !line.startsWith("/*")
      );
  }

  private isSignificantBlock(block: string[]): boolean {
    const joined = block.join(" ");
    // Ignore blocks that are just brackets or simple statements
    return (
      joined.length > 20 &&
      !joined.match(/^[\{\}\(\)\[\];\s]*$/) &&
      block.some(
        (line) => line.includes("(") || line.includes("=") || line.includes(".")
      )
    );
  }

  private hashCodeBlock(block: string[]): string {
    const content = block.join("\n");
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private filterOverlapping(
    locations: Array<{ start: number; end: number }>
  ): Array<{ start: number; end: number }> {
    const sorted = locations.sort((a, b) => a.start - b.start);
    const result: Array<{ start: number; end: number }> = [];

    for (const loc of sorted) {
      const lastResult = result[result.length - 1];
      if (!lastResult || lastResult.end < loc.start) {
        result.push(loc);
      }
    }

    return result;
  }

  private calculateSeverity(
    locations: Array<{ start: number; end: number }>
  ): "high" | "medium" | "low" {
    const lines = locations[0].end - locations[0].start + 1;
    const occurrences = locations.length;

    if (lines >= 10 || occurrences >= 4) {
      return "high";
    }
    if (lines >= 5 || occurrences >= 3) {
      return "medium";
    }
    return "low";
  }

  private detectSimilarPatterns(code: string): any[] {
    const patterns: any[] = [];
    const lines = code.split("\n");

    // Detect similar method signatures
    const methodSignatures: Map<string, number[]> = new Map();
    lines.forEach((line, index) => {
      const methodMatch = line.match(/(?:async\s+)?(\w+)\s*\([^)]*\)\s*\{?/);
      if (methodMatch) {
        const signature = this.normalizeMethodSignature(methodMatch[0]);
        if (!methodSignatures.has(signature)) {
          methodSignatures.set(signature, []);
        }
        methodSignatures.get(signature)!.push(index + 1);
      }
    });

    // Report similar methods
    methodSignatures.forEach((lineNumbers, signature) => {
      if (lineNumbers.length > 1) {
        patterns.push({
          type: "similar_methods",
          pattern: signature,
          lines: lineNumbers,
          message: "Multiple methods with similar signatures detected",
        });
      }
    });

    // Detect repeated patterns (like multiple if-else with same structure)
    const controlStructures = this.findRepeatedControlStructures(lines);
    patterns.push(...controlStructures);

    return patterns;
  }

  private normalizeMethodSignature(signature: string): string {
    return signature
      .replace(/\w+(?=\s*:)/g, "param") // Replace parameter names
      .replace(/:\s*\w+/g, ": Type") // Replace type annotations
      .replace(/\s+/g, " ")
      .trim();
  }

  private findRepeatedControlStructures(lines: string[]): any[] {
    const patterns: any[] = [];
    const ifPatterns: Map<string, number[]> = new Map();

    lines.forEach((line, index) => {
      if (line.includes("if") && line.includes("(")) {
        const structure = line
          .replace(/(['"`]).*?\1/g, "STRING") // Replace strings
          .replace(/\d+/g, "NUM") // Replace numbers
          .replace(/\w+/g, "VAR") // Replace variables
          .trim();

        if (!ifPatterns.has(structure)) {
          ifPatterns.set(structure, []);
        }
        ifPatterns.get(structure)!.push(index + 1);
      }
    });

    ifPatterns.forEach((lineNumbers, structure) => {
      if (lineNumbers.length >= 3) {
        patterns.push({
          type: "repeated_control_structure",
          pattern: "Repeated if-statement pattern",
          lines: lineNumbers,
          message: "Multiple similar conditional structures detected",
        });
      }
    });

    return patterns;
  }
}
