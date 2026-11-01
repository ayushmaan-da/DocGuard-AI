app.use((req, res) => res.status(404).json({ error: "Route not found" }));
