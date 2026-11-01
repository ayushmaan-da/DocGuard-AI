function routePattern() {
  return /\b(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/i;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function routeBlock(code, method, routePath) {
  const startPattern = new RegExp(`\\b(?:app|router)\\.${method}\\s*\\(\\s*["'\`]${escapeRegExp(routePath)}["'\`]`, "i");
  const start = code.search(startPattern);
  if (start < 0) return "";
  const remainder = code.slice(start + 1);
  const nextRoute = remainder.search(/\b(?:app|router)\.(?:get|post|put|patch|delete)\s*\(/i);
  return code.slice(start, nextRoute < 0 ? code.length : start + 1 + nextRoute);
}

function responseObjectArguments(routeSource) {
  const results = [];
  const callPattern = /\bres(?:\.status\s*\([^)]*\))?\.json\s*\(/g;
  let match;
  while ((match = callPattern.exec(routeSource))) {
    const open = routeSource.indexOf("(", match.index + match[0].length - 1);
    let depth = 1;
    let quote = null;
    let escaped = false;
    let close = open + 1;
    for (; close < routeSource.length && depth > 0; close++) {
      const char = routeSource[close];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = null;
        continue;
      }
      if (char === "'" || char === '"' || char === "`") quote = char;
      else if (char === "(") depth++;
      else if (char === ")") depth--;
    }
    if (depth === 0) results.push(routeSource.slice(open + 1, close - 1).trim());
    callPattern.lastIndex = Math.max(callPattern.lastIndex, close);
  }
  return results;
}

function hasObjectField(expression, field) {
  const escaped = escapeRegExp(field);
  return new RegExp(`(?:^|[,{]\\s*)(?:["']${escaped}["']|${escaped})\\s*(?::|(?=[,}]))`).test(expression);
}

function documentationSentences(documentation) {
  const sentences = [];
  for (const line of documentation.split(/\r?\n/)) {
    const matches = line.match(/[^.!?]+[.!?](?=\s|$)/g) || [];
    for (const match of matches) {
      const sentence = match.trim().replace(/^[-*]\s+/, "");
      if (sentence && documentation.includes(sentence)) sentences.push(sentence);
    }
  }
  return [...new Set(sentences)];
}

function sentenceAssertsResponseField(sentence, method, routePath, field, routeContext = false) {
  const routeMention = routeContext || new RegExp(`\\b${method}\\s+${escapeRegExp(routePath)}\\b`, "i").test(sentence);
  const fieldMention = new RegExp(`\\b${escapeRegExp(field)}\\b`, "i").test(sentence);
  const responseClaim = /\b(response|returns?|contains?|includes?|has|fields?)\b/i.test(sentence);
  const fieldIndex = sentence.search(new RegExp(`\\b${escapeRegExp(field)}\\b`, "i"));
  const prefix = fieldIndex < 0 ? "" : sentence.slice(0, fieldIndex);
  const negated = /\b(?:not|never|without|exclude|excludes|omit|omits|doesn't|does not)\b/i.test(prefix);
  return routeMention && fieldMention && responseClaim && !negated;
}

function sentenceInRouteSection(documentation, sentence, method, routePath) {
  let currentHeadingMatchesRoute = false;
  const routePattern = new RegExp(`\\b${method}\\s+${escapeRegExp(routePath)}(?:\\b|$)`, "i");
  for (const line of documentation.split(/\r?\n/)) {
    const heading = line.match(/^\s{0,3}#{1,6}\s+(.+)$/);
    if (heading) currentHeadingMatchesRoute = routePattern.test(heading[1].replace(/[`*_]/g, ""));
    if (line.includes(sentence)) return currentHeadingMatchesRoute;
  }
  return false;
}

function lastMentionedField(sentence, fields) {
  return fields
    .map(item => ({ item, index: sentence.search(new RegExp(`\\b${escapeRegExp(item.field)}\\b`, "i")) }))
    .filter(candidate => candidate.index >= 0)
    .sort((left, right) => right.index - left.index)[0]?.item;
}

function removedObjectFields(diff) {
  const removed = [];
  let method = null;
  let routePath = null;
  let responseCallSeen = false;
  let hunkLines = [];

  const flush = () => {
    if (responseCallSeen) removed.push(...hunkLines.filter(item => item.field));
    hunkLines = [];
    responseCallSeen = false;
  };

  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("@@")) {
      flush();
      method = null;
      routePath = null;
      continue;
    }
    if (!line || line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("---") || line.startsWith("+++")) continue;
    const marker = line[0];
    const content = marker === "+" || marker === "-" || marker === " " ? line.slice(1) : line;
    const routeMatch = content.match(routePattern());
    if (routeMatch) {
      method = routeMatch[1].toLowerCase();
      routePath = routeMatch[2];
    }
    if (/\bres(?:\.status\s*\([^)]*\))?\.json\s*\(/.test(content)) responseCallSeen = true;
    if (marker !== "-") continue;
    const fieldMatch = content.trim().match(/^(?:["'`]([A-Za-z_$][\w$]*)["'`]|([A-Za-z_$][\w$]*))\s*:\s*.+,?$/);
    if (fieldMatch && method && routePath) {
      hunkLines.push({ method, routePath, field: fieldMatch[1] || fieldMatch[2], evidence: content });
    }
  }
  flush();
  return removed;
}

export function detectRemovedResponseFields({ originalCode, updatedCode, diff, documentation }) {
  const removed = removedObjectFields(diff);
  const sentences = documentationSentences(documentation);
  const findings = [];
  const checked = new Set();

  for (const item of removed) {
    const routeKey = `${item.method} ${item.routePath} ${item.field}`;
    if (checked.has(routeKey)) continue;
    checked.add(routeKey);
    const originalRoute = routeBlock(originalCode, item.method, item.routePath);
    const updatedRoute = routeBlock(updatedCode, item.method, item.routePath);
    if (!originalRoute || !updatedRoute) continue;
    const originalObjects = responseObjectArguments(originalRoute);
    const updatedObjects = responseObjectArguments(updatedRoute);
    if (!originalObjects.some(object => hasObjectField(object, item.field))) continue;
    if (!updatedObjects.length || updatedObjects.some(object => hasObjectField(object, item.field))) continue;
    item.verified = true;
  }

  for (const sentence of sentences) {
    const matchingItems = removed.filter(item => item.verified && sentenceAssertsResponseField(
      sentence,
      item.method,
      item.routePath,
      item.field,
      sentenceInRouteSection(documentation, sentence, item.method, item.routePath)
    ));
    if (!matchingItems.length) continue;
    // Emit one finding per exact README sentence. When a sentence lists several
    // removed fields, cite the final field it names so the single evidence line
    // directly supports one specific, checkable mismatch.
    const item = lastMentionedField(sentence, matchingItems);
    if (!item) continue;
    item.sentence = sentence;
    item.reason = `The documented ${item.field} field was removed from the ${item.method.toUpperCase()} ${item.routePath} JSON response.`;
    findings.push({
      outdated: true,
      sentence,
      evidenceType: "removed",
      codeEvidence: item.evidence,
      reason: item.reason
    });
  }
  return findings;
}
