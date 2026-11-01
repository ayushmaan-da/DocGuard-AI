const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// Hardcoded in-memory data for repeatable documentation-drift testing.
let users = [
  {
    id: 1,
    name: "Aarav Sharma",
    email: "aarav@example.com",
    role: "student",
    active: true
  },
  {
    id: 2,
    name: "Diya Verma",
    email: "diya@example.com",
    role: "admin",
    active: true
  },
  {
    id: 3,
    name: "Kabir Mehta",
    email: "kabir@example.com",
    role: "student",
    active: false
  }
];

const allowedRoles = ["student", "admin"];
const allowedUserFields = ["name", "email", "role", "active"];

function isValidEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function emailAlreadyExists(email, exceptUserId = null) {
  const normalizedEmail = email.trim().toLowerCase();
  return users.some(
    user =>
      user.id !== exceptUserId &&
      user.email.toLowerCase() === normalizedEmail
  );
}

function findUserIndex(id) {
  return users.findIndex(user => user.id === id);
}

function validUserFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Request body must be a JSON object.";
  }

  if (typeof body.name !== "string" || body.name.trim().length === 0) {
    return "Name must be a non-empty string.";
  }

  if (!isValidEmail(body.email)) {
    return "A valid email address is required.";
  }

  if (!allowedRoles.includes(body.role)) {
    return "Role must be either student or admin.";
  }

  if (typeof body.active !== "boolean") {
    return "Active must be a boolean.";
  }

  return null;
}

// GET / - API information.
app.get("/", (req, res) => {
  res.status(200).json({
    message: "User Management API is running",
    version: "1.0.0"
  });
});

// GET /api/health - health check.
app.get("/api/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    uptime: process.uptime()
  });
});

// GET /api/users - return all users.
app.get("/api/users", (req, res) => {
  res.status(200).json({
    data: users
  }); 
});
// GET /api/users/:id - return one user.
app.get("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "User ID must be a positive integer." });
  }

  const user = users.find(item => item.id === id);

  if (!user) {
    return res.status(404).json({ message: "User not found." });
  }

  return res.status(200).json({ data: user });
});

// POST /api/users - create a user.
app.post("/api/users", (req, res) => {
  const body = req.body ?? {};
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const role = body.role === undefined ? "student" : body.role;
  const active = body.active === undefined ? true : body.active;

  if (!name) {
    return res.status(400).json({ message: "Name is required." });
  }

  if (!isValidEmail(email)) {
    return res.status(400).json({ message: "A valid email address is required." });
  }

  if (!allowedRoles.includes(role)) {
    return res.status(400).json({ message: "Role must be either student or admin." });
  }

  if (typeof active !== "boolean") {
    return res.status(400).json({ message: "Active must be a boolean." });
  }

  if (emailAlreadyExists(email)) {
    return res.status(409).json({ message: "Email already exists." });
  }

  const nextId = users.reduce((largestId, user) => Math.max(largestId, user.id), 0) + 1;
  const newUser = { id: nextId, name, email, role, active };
  users.push(newUser);

  return res.status(201).json({
    message: "User created successfully.",
    data: newUser
  });
});

// PUT /api/users/:id - replace every editable field of a user.
app.put("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "User ID must be a positive integer." });
  }

  const index = findUserIndex(id);

  if (index === -1) {
    return res.status(404).json({ message: "User not found." });
  }

  const validationError = validUserFields(req.body);

  if (validationError) {
    return res.status(400).json({ message: validationError });
  }

  const { name, email, role, active } = req.body;

  if (emailAlreadyExists(email, id)) {
    return res.status(409).json({ message: "Email already exists." });
  }

  const updatedUser = {
    id,
    name: name.trim(),
    email: email.trim(),
    role,
    active
  };

  users[index] = updatedUser;

  return res.status(200).json({
    message: "User replaced successfully.",
    data: updatedUser
  });
});

// PATCH /api/users/:id - update only the supplied editable fields.
app.patch("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "User ID must be a positive integer." });
  }

  const index = findUserIndex(id);

  if (index === -1) {
    return res.status(404).json({ message: "User not found." });
  }

  const body = req.body;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ message: "Request body must be a JSON object." });
  }

  const suppliedFields = Object.keys(body);

  if (suppliedFields.length === 0) {
    return res.status(400).json({ message: "At least one field must be supplied." });
  }

  const unsupportedFields = suppliedFields.filter(
    field => !allowedUserFields.includes(field)
  );

  if (unsupportedFields.length > 0) {
    return res.status(400).json({
      message: `Unsupported fields: ${unsupportedFields.join(", ")}.`
    });
  }

  if (body.name !== undefined && (typeof body.name !== "string" || !body.name.trim())) {
    return res.status(400).json({ message: "Name must be a non-empty string." });
  }

  if (body.email !== undefined && !isValidEmail(body.email)) {
    return res.status(400).json({ message: "A valid email address is required." });
  }

  if (body.role !== undefined && !allowedRoles.includes(body.role)) {
    return res.status(400).json({ message: "Role must be either student or admin." });
  }

  if (body.active !== undefined && typeof body.active !== "boolean") {
    return res.status(400).json({ message: "Active must be a boolean." });
  }

  if (body.email !== undefined && emailAlreadyExists(body.email, id)) {
    return res.status(409).json({ message: "Email already exists." });
  }

  const updatedUser = {
    ...users[index],
    ...body
  };

  if (body.name !== undefined) updatedUser.name = body.name.trim();
  if (body.email !== undefined) updatedUser.email = body.email.trim();

  users[index] = updatedUser;

  return res.status(200).json({
    message: "User updated successfully.",
    data: updatedUser
  });
});

// DELETE /api/users/:id - permanently remove a user from memory.
app.delete("/api/users/:id", (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ message: "User ID must be a positive integer." });
  }

  const index = findUserIndex(id);

  if (index === -1) {
    return res.status(404).json({ message: "User not found." });
  }

  users.splice(index, 1);
  return res.status(204).send();
});

// Fallback for unknown routes.
app.use((req, res) => {
  res.status(404).json({ message: "Route not found." });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`User Management API running at http://localhost:${PORT}`);
  });
}

module.exports = app;
