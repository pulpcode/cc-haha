# Provider Preset Redesign

## Overview

Replace the manual provider configuration UI with a preset-based system inspired by [cc-switch](https://github.com/farion1231/cc-switch) (MIT License, Copyright 2025 Jason Young). Users select a preset provider, enter an API key, and the system writes the correct env vars to `~/.claude/settings.json`.

## Presets

Six presets, each with pre-configured baseUrl and model mapping:

| ID | Name | baseUrl | Main Model | API Key Required |
|---|---|---|---|---|
| `official` | Claude Official | _(clear env)_ | _(default)_ | No |
| `deepseek` | DeepSeek | `https://api.deepseek.com/anthropic` | `DeepSeek-V3.2` | Yes |
| `zhipuglm` | Zhipu GLM | `https://open.bigmodel.cn/api/anthropic` | `glm-5` | Yes |
| `kimi` | Kimi | `https://api.moonshot.cn/anthropic` | `kimi-k2.5` | Yes |
| `minimax` | MiniMax | `https://api.minimaxi.com/anthropic` | `MiniMax-M2.7` | Yes |
| `custom` | Custom | User-provided | User-provided | Yes |

Each preset defaults Haiku/Sonnet/Opus to the same as main model. Users can override via advanced settings.

## Data Flow

```
Preset Provider List (frontend hardcoded)
        |
User selects preset -> enters API Key -> optionally customizes model mapping
        |
Save -> write ~/.claude/cc-haha/providers.json (index of saved providers)
     -> write ~/.claude/settings.json env block (active provider only)
        |
Claude Code reads settings.json on next session
```

## Storage

### Index File: `~/.claude/cc-haha/providers.json`

Stores all saved provider profiles for switching. Lightweight — no full settingsConfig, just what's needed to reconstruct the env block.

```json
{
  "activeId": "deepseek-1",
  "providers": [
    {
      "id": "deepseek-1",
      "presetId": "deepseek",
      "name": "DeepSeek",
      "apiKey": "sk-xxx",
      "baseUrl": "https://api.deepseek.com/anthropic",
      "models": {
        "main": "DeepSeek-V3.2",
        "haiku": "DeepSeek-V3.2",
        "sonnet": "DeepSeek-V3.2",
        "opus": "DeepSeek-V3.2"
      },
      "notes": ""
    }
  ]
}
```

For `custom` preset, `baseUrl` is user-provided. For other presets, `baseUrl` comes from the preset default but can be overridden.

### settings.json env block (written on activation)

Third-party provider activation writes 6 keys:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://api.deepseek.com/anthropic",
    "ANTHROPIC_AUTH_TOKEN": "sk-xxx",
    "ANTHROPIC_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "DeepSeek-V3.2",
    "ANTHROPIC_DEFAULT_OPUS_MODEL": "DeepSeek-V3.2"
  }
}
```

Official provider activation removes these 6 keys from env, preserving all other settings.json fields.

## Frontend UI

### ProviderSettings Component

Replaces current provider list + modal with:

1. **Preset chip bar** — horizontal row: `官方` | `DeepSeek` | `ZhipuGLM` | `Kimi` | `MiniMax` | `自定义`
2. **Saved provider list** — cards showing each saved provider with active badge, switch/edit/delete actions
3. **Add/Edit form** (inline or modal):
   - Preset selector (chips, pre-fills form)
   - API Key input (not shown for official)
   - Base URL input (only shown for custom preset, or editable in advanced)
   - Model mapping (collapsible advanced section): Main / Haiku / Sonnet / Opus inputs, pre-filled from preset
   - Notes (optional)
   - Test Connection button
   - Save / Cancel buttons

### Activation Flow

- Click "Activate" on a saved provider card
- Backend writes env to settings.json
- UI updates active badge
- Official preset clears env keys

### Delete Provider

- Cannot delete the active provider (must switch first, or switch to official)
- Confirmation dialog before delete

## Backend Changes

### New: `src/server/config/providerPresets.ts`

Shared preset definitions used by both API validation and settings generation.

```typescript
export type ProviderPreset = {
  id: string
  name: string
  baseUrl: string
  models: { main: string; haiku: string; sonnet: string; opus: string }
  needsApiKey: boolean
  websiteUrl: string
}
```

### Modified: `src/server/services/providerService.ts`

- Change storage path from `~/.claude/providers.json` to `~/.claude/cc-haha/providers.json`
- Simplify provider data structure (remove ProviderModel array, use models record)
- `syncToSettings()` writes all 6 env keys
- New `clearProviderFromSettings()` for official preset — removes the 6 env keys
- Remove `activateProvider(id, modelId)` modelId param — models stored in provider config
- Ensure `~/.claude/cc-haha/` directory is created on first write

### Modified: `src/server/api/providers.ts`

- Update activate endpoint: `POST /api/providers/:id/activate` (no body needed)
- Add preset list endpoint: `GET /api/providers/presets` (returns preset definitions)

### Deleted after migration

- Old `~/.claude/providers.json` is not migrated — users reconfigure (acceptable since this is pre-release)

## Frontend File Changes

| Action | File | Description |
|--------|------|-------------|
| New | `desktop/src/config/providerPresets.ts` | Frontend preset definitions |
| Rewrite | `desktop/src/pages/Settings.tsx` ProviderSettings section | Preset-based UI |
| Modify | `desktop/src/types/provider.ts` | Simplify types (remove ProviderModel, add models record) |
| Modify | `desktop/src/stores/providerStore.ts` | Align with new API shape |
| Modify | `desktop/src/api/providers.ts` | Update activate call (remove modelId), add presets endpoint |

## Backend File Changes

| Action | File | Description |
|--------|------|-------------|
| New | `src/server/config/providerPresets.ts` | Preset definitions |
| Modify | `src/server/services/providerService.ts` | New storage path, simplified model structure, full env write |
| Modify | `src/server/types/provider.ts` | Simplify schema |
| Modify | `src/server/api/providers.ts` | Update routes |

## Attribution

```typescript
// Provider presets inspired by cc-switch (https://github.com/farion1231/cc-switch)
// Original work by Jason Young, MIT License
```

Added as comment header in preset configuration files.

## Testing

1. Select DeepSeek preset, enter API key, save — verify `~/.claude/cc-haha/providers.json` and `~/.claude/settings.json` written correctly
2. Switch to Kimi — verify settings.json updated, index updated
3. Switch to Official — verify env keys removed from settings.json
4. Edit a provider's model mapping — verify changes persisted
5. Test Connection — verify connectivity check works
6. Delete non-active provider — verify removed from index
7. Custom preset — verify baseUrl input appears, full flow works
