if ([req.body.name, req.body.email].some(value => value.trim() === "")) return res.status(400).end();
