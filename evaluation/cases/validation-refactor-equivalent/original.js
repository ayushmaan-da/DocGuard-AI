if (req.body.name.trim() === "" || req.body.email.trim() === "") return res.status(400).end();
