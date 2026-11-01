# DocGuard AI frontend

## Local development

Start the backend from the repository root in a separate terminal:

```sh
export OLLAMA_MODEL='your-installed-model'
npm start
```

The backend defaults to `http://localhost:3000`. Start the frontend from this
directory:

```sh
npm ci
cp .env.example .env
npm run dev
```

Vite defaults to `http://localhost:5173`. `VITE_API_URL` in `.env` should point
to the backend API base URL, normally `http://localhost:3000/api`. The backend
does not load `.env` files automatically; configure its Ollama environment in
the backend process.

The Pull Request page analyzes exact source changes against documentation at
the PR head revision. Confirmed deterministic findings and unverified model
suggestions are shown separately; files without a GitHub patch are listed as
skipped.

## Validation

```sh
npm run lint
npm run build
```
