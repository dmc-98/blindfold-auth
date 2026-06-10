# Local Workspace Example

This example shows the package-first shape of Blindfold Auth.

It stores auth data in a local JSON file so you can try the workflow without bringing a database online first. In a production app you would swap this for the PostgreSQL adapter.

## Start

```sh
npm install
node ../../packages/auth-cli/bin/blindfold-auth.js bootstrap --config ./blindfold.config.js --workspace-name "Blindfold Demo"
node ../../packages/auth-cli/bin/blindfold-auth.js seed-demo --config ./blindfold.config.js
node ../../packages/auth-cli/bin/blindfold-auth.js studio --config ./blindfold.config.js --port 4110
```

The Studio will persist into `examples/local-workspace/.blindfold/workspace.json`.

