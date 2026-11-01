function findResponseBodies(source) {
  const bodies = [];
  const responseCall = /\bres(?:\s*\.\s*[A-Za-z_$][\w$]*\s*\([^)]*\))*\s*\.\s*json\s*\(\s*\{/g;
  for (const match of source.matchAll(responseCall)) {
    const openIndex = match.index + match[0].lastIndexOf('{');
    let depth = 1;
    let quote = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    for (let index = openIndex + 1; index < source.length; index += 1) {
      const character = source[index];
      const next = source[index + 1];
      if (lineComment) {
        if (character === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        if (character === '*' && next === '/') {
          blockComment = false;
          index += 1;
        }
        continue;
      }
      if (quote) {
        if (escaped) escaped = false;
        else if (character === '\\') escaped = true;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '/' && next === '/') {
        lineComment = true;
        index += 1;
      } else if (character === '/' && next === '*') {
        blockComment = true;
        index += 1;
      } else if (character === '"' || character === "'" || character === '`') {
        quote = character;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(openIndex + 1, index));
          break;
        }
      }
    }
  }
  return bodies;
}

function getResponseFields(source) {
  const fields = new Set();
  for (const body of findResponseBodies(source)) {
    let depth = 1;
    let quote = null;
    let escaped = false;
    for (const line of body.split(/\r?\n/)) {
      if (depth === 1) {
        const property = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
        if (property) fields.add(property[1]);
      }
      for (const character of line) {
        if (quote) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === quote) quote = null;
        } else if (character === '"' || character === "'" || character === '`') {
          quote = character;
        } else if (character === '{') {
          depth += 1;
        } else if (character === '}') {
          depth -= 1;
        }
      }
    }
  }
  return fields;
}

function getRouteContext(source) {
  const route = source.match(/\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/i);
  return route ? { method: route[1].toUpperCase(), path: route[3] } : null;
}

function splitSentences(documentation) {
  let sectionRoute = null;
  return documentation.split(/\r?\n/).flatMap((line) => {
    const heading = line.match(/^#{1,6}\s+(GET|POST|PUT|PATCH|DELETE)\s+[`'"]?(\/[^`'"\s]+)/i);
    if (/^#{1,6}\s/.test(line)) {
      sectionRoute = heading
        ? { method: heading[1].toUpperCase(), path: heading[2].replace(/[.,;!?]+$/, '') }
        : null;
    }
    return (line.match(/[^.!?]+[.!?]?/g) ?? [])
      .map((sentence) => sentence.trim())
      .filter(Boolean)
      .map((sentence) => ({ sentence, sectionRoute }));
  });
}

function matchesRoute(context, expectedRoute) {
  const mentionedRoute = context.sentence.match(/\b(GET|POST|PUT|PATCH|DELETE)\s+[`'"]?(\/[^`'"\s]+)/i);
  if (mentionedRoute) {
    return mentionedRoute[1].toUpperCase() === expectedRoute.method
      && mentionedRoute[2].replace(/[.,;!?]+$/, '') === expectedRoute.path;
  }
  const path = context.sentence.match(/[`'"](\/[^`'"]+)[`'"]/);
  if (path) return path[1] === expectedRoute.path;
  return context.sectionRoute?.method === expectedRoute.method
    && context.sectionRoute?.path === expectedRoute.path;
}

function isPositiveFieldClaim(sentence, field) {
  const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fieldMention = new RegExp(`\\b${escapedField}\\b`, 'i');
  const claimVerb = /\b(?:returns?|includes?|contains?|exposes?|responds?\s+with)\b/i;
  const negation = /\b(?:does\s+not|doesn't|do\s+not|don't|never)\b/i;
  const mentionIndex = sentence.search(fieldMention);
  if (mentionIndex < 0 || !claimVerb.test(sentence)) return false;
  return !negation.test(sentence.slice(Math.max(0, mentionIndex - 48), mentionIndex + field.length + 12));
}

function detectRemovedResponseFields({
  originalCode,
  updatedCode,
  diff,
  documentation,
}) {
  if ([originalCode, updatedCode, diff, documentation].some((value) => typeof value !== 'string')) {
    return [];
  }

  const route = getRouteContext(originalCode);
  if (!route) return [];

  const originalFields = getResponseFields(originalCode);
  const updatedFields = getResponseFields(updatedCode);
  const removedLines = diff.split(/\r?\n/)
    .filter((line) => line.startsWith('-') && !line.startsWith('---'))
    .map((line) => line.slice(1));
  const removedFields = new Set(removedLines.flatMap((line) => {
    const property = line.match(/^\s*([A-Za-z_$][\w$]*)\s*:/);
    return property ? [property[1]] : [];
  }));
  const candidates = [...removedFields]
    .filter((field) => originalFields.has(field) && !updatedFields.has(field))
    .sort();
  if (candidates.length === 0) return [];

  const findings = [];
  for (const context of splitSentences(documentation)) {
    if (!matchesRoute(context, route)) continue;
    const { sentence } = context;
    const field = candidates.find((candidate) => isPositiveFieldClaim(sentence, candidate));
    if (!field) continue;

    const escapedField = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const removedLine = removedLines.find((line) => new RegExp(`^\\s*${escapedField}\\s*:`).test(line));
    const codeEvidence = originalCode.split(/\r?\n/).find((line) => (
      removedLine !== undefined && line.trim() === removedLine.trim()
    ));
    if (!codeEvidence) continue;

    findings.push({
      outdated: true,
      sentence,
      evidenceType: 'removed',
      codeEvidence,
      reason: `The documented ${field} field was removed from the ${route.method} ${route.path} JSON response.`,
    });
  }
  return findings;
}

module.exports = { detectRemovedResponseFields };
