# Configuration

Lumen reads its settings from `lumen.config.json` at the root of your project. Every option has a default, so the file can start empty and grow as you need it.

## Output directory

Built pages are written to `dist` unless you set `outputDirectory`. The path is resolved relative to the config file. See [the build command](https://lumen.example/docs/cli#build) for overriding it from the command line.

```json
{
  "outputDirectory": "public",
  "minify": true
}
```

## All options

| Option | Default | Description |
| --- | --- | --- |
| outputDirectory | dist | Where built pages go |
| minify | false | Minify HTML and CSS |

Questions? Email the team.
