const finding = (sentence, evidenceType, codeEvidence) => ({ outdated: true, sentence, evidenceType, codeEvidence });

export default [
  {
    id: "post-status-code",
    category: "status-code drift",
    description: "POST changes from documented 201 to 200.",
    readme: "POST /users responds with HTTP status 201.",
    original: 'app.post("/users", (req, res) => {\n  res.status(201).json(req.body);\n});\n',
    updated: 'app.post("/users", (req, res) => {\n  res.status(200).json(req.body);\n});\n',
    expected: [finding("POST /users responds with HTTP status 201.", "added", "  res.status(200).json(req.body);")]
  },
  {
    id: "collection-response-shape",
    category: "response shape",
    description: "Collection response changes from array to an object wrapper.",
    readme: "GET /users returns a JSON array of users.",
    original: 'app.get("/users", (req, res) => {\n  res.json(users);\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  res.json({ users });\n});\n',
    expected: [finding("GET /users returns a JSON array of users.", "added", "  res.json({ users });")]
  },
  {
    id: "delete-status-and-body",
    category: "status and body",
    description: "DELETE stops returning the documented empty 204 response.",
    readme: "DELETE /users/:id returns status 204 with an empty body.",
    original: 'app.delete("/users/:id", (req, res) => {\n  res.status(204).end();\n});\n',
    updated: 'app.delete("/users/:id", (req, res) => {\n  res.status(200).json({ deleted: true });\n});\n',
    expected: [finding("DELETE /users/:id returns status 204 with an empty body.", "added", "  res.status(200).json({ deleted: true });")]
  },
  {
    id: "get-by-id-wrong-resource",
    category: "resource selection",
    description: "GET by ID stops returning the matching resource.",
    readme: "GET /users/:id returns the user whose ID matches the route parameter.",
    original: 'app.get("/users/:id", (req, res) => {\n  const user = users.find(item => item.id === req.params.id);\n  res.json(user);\n});\n',
    updated: 'app.get("/users/:id", (req, res) => {\n  const user = users.find(item => item.id === req.params.id);\n  res.json(users[0]);\n});\n',
    expected: [finding("GET /users/:id returns the user whose ID matches the route parameter.", "added", "  res.json(users[0]);")]
  },
  {
    id: "put-replacement-becomes-merge",
    category: "PUT semantics",
    description: "PUT begins preserving fields omitted from the request.",
    readme: "PUT /users/:id replaces the resource and removes fields omitted from the request.",
    original: 'users[index] = { id: req.params.id, name: req.body.name, email: req.body.email };\n',
    updated: 'users[index] = { ...users[index], ...req.body };\n',
    expected: [finding("PUT /users/:id replaces the resource and removes fields omitted from the request.", "added", "users[index] = { ...users[index], ...req.body };")]
  },
  {
    id: "patch-drops-omitted-fields",
    category: "PATCH semantics",
    description: "PATCH starts discarding fields the request omits.",
    readme: "PATCH /users/:id changes only supplied fields and preserves omitted fields.",
    original: 'Object.assign(user, req.body);\n',
    updated: 'users[index] = { id: req.params.id, ...req.body };\n',
    expected: [finding("PATCH /users/:id changes only supplied fields and preserves omitted fields.", "added", "users[index] = { id: req.params.id, ...req.body };")]
  },
  {
    id: "optional-email-becomes-required",
    category: "validation drift",
    description: "POST adds a requirement that contradicts an optional-field claim.",
    readme: "The email field is optional when creating a user.",
    original: 'app.post("/users", (req, res) => {\n  users.push(req.body);\n  res.status(201).json(req.body);\n});\n',
    updated: 'app.post("/users", (req, res) => {\n  if (!req.body.email) return res.status(400).json({ error: "email required" });\n  users.push(req.body);\n  res.status(201).json(req.body);\n});\n',
    expected: [finding("The email field is optional when creating a user.", "added", '  if (!req.body.email) return res.status(400).json({ error: "email required" });')]
  },
  {
    id: "duplicate-emails-now-rejected",
    category: "validation drift",
    description: "POST introduces duplicate-email rejection contrary to the README.",
    readme: "The API allows multiple users to share an email address.",
    original: 'app.post("/users", (req, res) => {\n  users.push(req.body);\n  res.status(201).json(req.body);\n});\n',
    updated: 'app.post("/users", (req, res) => {\n  if (users.some(user => user.email === req.body.email)) return res.status(409).json({ error: "duplicate email" });\n  users.push(req.body);\n  res.status(201).json(req.body);\n});\n',
    expected: [finding("The API allows multiple users to share an email address.", "added", '  if (users.some(user => user.email === req.body.email)) return res.status(409).json({ error: "duplicate email" });')]
  },
  {
    id: "query-filter-removed",
    category: "query behavior",
    description: "GET /users stops applying its documented name filter.",
    readme: "GET /users?name= filters the collection to users with that name.",
    original: 'app.get("/users", (req, res) => {\n  const results = users.filter(user => user.name === req.query.name);\n  res.json(results);\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  res.json(users);\n});\n',
    expected: [finding("GET /users?name= filters the collection to users with that name.", "added", "  res.json(users);")]
  },
  {
    id: "missing-user-status",
    category: "not-found behavior",
    description: "A missing user changes from 404 to 200.",
    readme: "GET /users/:id returns status 404 when the user does not exist.",
    original: 'if (!user) return res.status(404).json({ error: "User not found" });\n',
    updated: 'if (!user) return res.status(200).json(null);\n',
    expected: [finding("GET /users/:id returns status 404 when the user does not exist.", "added", 'if (!user) return res.status(200).json(null);')]
  },
  {
    id: "authentication-added",
    category: "authentication",
    description: "A formerly public route starts requiring authentication.",
    readme: "User routes are public and do not require authentication.",
    original: 'app.get("/users", (req, res) => {\n  res.json(users);\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  if (!req.user) return res.status(401).json({ error: "Unauthorized" });\n  res.json(users);\n});\n',
    expected: [finding("User routes are public and do not require authentication.", "added", '  if (!req.user) return res.status(401).json({ error: "Unauthorized" });')]
  },
  {
    id: "error-response-key-changed",
    category: "error response shape",
    description: "Error payload changes its documented property name.",
    readme: "Error responses contain a JSON `error` property.",
    original: 'return res.status(404).json({ error: "User not found" });\n',
    updated: 'return res.status(404).json({ message: "User not found" });\n',
    expected: [finding("Error responses contain a JSON `error` property.", "added", 'return res.status(404).json({ message: "User not found" });')]
  },
  {
    id: "collection-now-truncated",
    category: "collection completeness",
    description: "GET /users silently truncates its documented full collection.",
    readme: "GET /users returns every user in the collection.",
    original: 'res.json(users);\n',
    updated: 'res.json(users.slice(0, 10));\n',
    expected: [finding("GET /users returns every user in the collection.", "added", "res.json(users.slice(0, 10));")]
  },
  {
    id: "unknown-route-status",
    category: "unknown route behavior",
    description: "Unknown routes stop returning 404.",
    readme: "Unknown routes return status 404.",
    original: 'app.use((req, res) => res.status(404).json({ error: "Route not found" }));\n',
    updated: 'app.use((req, res) => res.status(200).json({ error: "Route not found" }));\n',
    expected: [finding("Unknown routes return status 404.", "added", 'app.use((req, res) => res.status(200).json({ error: "Route not found" }));')]
  },
  {
    id: "route-removed",
    category: "route removal",
    description: "The documented resource route is removed.",
    readme: "GET /users/:id returns one user by ID.",
    original: 'app.get("/users/:id", (req, res) => {\n  res.json(users.find(user => user.id === req.params.id));\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  res.json(users);\n});\n',
    expected: [finding("GET /users/:id returns one user by ID.", "removed", 'app.get("/users/:id", (req, res) => {')]
  },
  {
    id: "status-refactor-no-drift",
    category: "behavior-preserving change",
    description: "Return and explicit 200 preserve the documented response.",
    readme: "GET /users returns a JSON array of users with status 200.",
    original: 'app.get("/users", (req, res) => {\n  res.json(users);\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  return res.status(200).json(users);\n});\n',
    expected: []
  },
  {
    id: "preexisting-documentation-mismatch",
    category: "pre-existing inaccuracy",
    description: "The README was already wrong and the code change does not worsen it.",
    readme: "GET /users returns a JSON array of users.",
    original: 'app.get("/users", (req, res) => {\n  res.json({ users });\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  console.log("collection requested");\n  res.json({ users });\n});\n',
    expected: []
  },
  {
    id: "undocumented-normalization",
    category: "undocumented behavior change",
    description: "Email normalization changes internally but no README claim describes casing.",
    readme: "POST /users accepts an email address and returns the created user.",
    original: 'const user = { email: req.body.email };\n',
    updated: 'const user = { email: req.body.email.toLowerCase() };\n',
    expected: []
  },
  {
    id: "validation-refactor-equivalent",
    category: "semantic equivalence",
    description: "Validation is rewritten with equivalent array logic.",
    readme: "POST /users rejects empty `name` or `email` values.",
    original: 'if (req.body.name.trim() === "" || req.body.email.trim() === "") return res.status(400).end();\n',
    updated: 'if ([req.body.name, req.body.email].some(value => value.trim() === "")) return res.status(400).end();\n',
    expected: []
  },
  {
    id: "array-copy-equivalent",
    category: "semantic equivalence",
    description: "Returning a shallow copy preserves the documented array response.",
    readme: "GET /users returns a JSON array containing all users.",
    original: 'res.json(users);\n',
    updated: 'res.json([...users]);\n',
    expected: []
  },
  {
    id: "comment-only-change",
    category: "non-behavioral change",
    description: "A comment changes without changing endpoint behavior.",
    readme: "GET /users returns a JSON array of users.",
    original: 'app.get("/users", (req, res) => {\n  // Return the full collection.\n  res.json(users);\n});\n',
    updated: 'app.get("/users", (req, res) => {\n  // Send all records.\n  res.json(users);\n});\n',
    expected: []
  }
];
