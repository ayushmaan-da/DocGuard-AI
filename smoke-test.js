const assert = require("node:assert/strict");
const app = require("./app");

const server = app.listen(0, async () => {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let passed = 0;

  async function check(name, method, path, expectedStatus, body, verify) {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });

    assert.equal(response.status, expectedStatus, `${name}: unexpected status`);
    const raw = await response.text();
    const data = raw ? JSON.parse(raw) : null;

    if (verify) verify(data, raw, response);
    passed += 1;
    console.log(`PASS ${name}`);
    return { data, raw, response };
  }

  try {
    await check("GET / API information", "GET", "/", 200, undefined, data => {
      assert.equal(data.message, "User Management API is running");
      assert.equal(data.version, "1.0.0");
    });

    await check("GET /api/health", "GET", "/api/health", 200, undefined, data => {
      assert.equal(data.status, "ok");
      assert.equal(typeof data.uptime, "number");
    });

    await check("GET /api/users current changed response", "GET", "/api/users", 200, undefined, data => {
      assert.equal(Object.hasOwn(data, "success"), false);
      assert.equal(Object.hasOwn(data, "count"), false);
      assert.equal(data.data.length, 3);
    });

    await check("GET /api/users/:id existing user", "GET", "/api/users/1", 200, undefined, data => {
      assert.equal(data.data.id, 1);
    });

    await check("GET /api/users/:id invalid ID", "GET", "/api/users/nope", 400, undefined);
    await check("GET /api/users/:id missing user", "GET", "/api/users/999", 404, undefined);

    const created = await check(
      "POST /api/users creates a user",
      "POST",
      "/api/users",
      201,
      { name: "Lina Kapoor", email: "lina@example.com" },
      data => {
        assert.equal(data.data.id, 4);
        assert.equal(data.data.role, "student");
        assert.equal(data.data.active, true);
      }
    );
    const createdId = created.data.data.id;

    await check(
      "POST /api/users rejects duplicate email",
      "POST",
      "/api/users",
      409,
      { name: "Another User", email: "AARAV@example.com" }
    );

    await check(
      "POST /api/users rejects invalid body",
      "POST",
      "/api/users",
      400,
      { email: "missing-name@example.com" }
    );

    await check(
      "PUT /api/users/:id replaces all editable fields",
      "PUT",
      "/api/users/1",
      200,
      {
        name: "Aarav Updated",
        email: "aarav.updated@example.com",
        role: "admin",
        active: false
      },
      data => {
        assert.equal(data.data.name, "Aarav Updated");
        assert.equal(data.data.role, "admin");
        assert.equal(data.data.active, false);
      }
    );

    await check(
      "PUT /api/users/:id rejects incomplete replacement",
      "PUT",
      "/api/users/1",
      400,
      { name: "Incomplete", email: "incomplete@example.com", role: "student" }
    );

    await check("PUT /api/users/:id missing user", "PUT", "/api/users/999", 404, {
      name: "Missing",
      email: "missing@example.com",
      role: "student",
      active: true
    });

    await check(
      "PATCH /api/users/:id updates only supplied fields",
      "PATCH",
      "/api/users/1",
      200,
      { name: "Aarav Patched" },
      data => {
        assert.equal(data.data.name, "Aarav Patched");
        assert.equal(data.data.email, "aarav.updated@example.com");
        assert.equal(data.data.active, false);
      }
    );

    await check("PATCH /api/users/:id rejects empty body", "PATCH", "/api/users/1", 400, {});
    await check("PATCH /api/users/:id rejects unsupported fields", "PATCH", "/api/users/1", 400, { id: 88 });
    await check("PATCH /api/users/:id rejects invalid role", "PATCH", "/api/users/1", 400, { role: "owner" });
    await check("PATCH /api/users/:id missing user", "PATCH", "/api/users/999", 404, { name: "Nobody" });

    await check("DELETE /api/users/:id deletes user", "DELETE", `/api/users/${createdId}`, 204, undefined, (data, raw) => {
      assert.equal(data, null);
      assert.equal(raw, "");
    });

    await check("DELETE /api/users/:id missing user", "DELETE", "/api/users/999", 404, undefined);
    await check("DELETE /api/users/:id invalid ID", "DELETE", "/api/users/abc", 400, undefined);
    await check("Unknown route fallback", "GET", "/does-not-exist", 404, undefined, data => {
      assert.equal(data.message, "Route not found.");
    });

    console.log(`\n${passed} API smoke tests passed.`);
  } catch (error) {
    console.error("\nAPI smoke test failed:", error.message);
    process.exitCode = 1;
  } finally {
    server.close();
  }
});
