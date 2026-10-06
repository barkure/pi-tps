# pi-tps

Minimal Pi extension that shows real-time `TPS: 25.0 · TTFT 350ms` in the status bar, color-coded by speed across 4 tiers.

<table>
  <tr>
    <td align="center" valign="middle">Tier</td>
    <td align="center" valign="middle">Slow</td>
    <td align="center" valign="middle">Medium</td>
    <td align="center" valign="middle">Fast</td>
    <td align="center" valign="middle">Blazing</td>
  </tr>
  <tr>
    <td align="center" valign="middle">TPS</td>
    <td align="center" valign="middle"><img src="https://img.shields.io/badge/-0--15-f87171?style=flat-square" alt="0-15"></td>
    <td align="center" valign="middle"><img src="https://img.shields.io/badge/-15--30-fbbf24?style=flat-square" alt="15-30"></td>
    <td align="center" valign="middle"><img src="https://img.shields.io/badge/-30--50-34d399?style=flat-square" alt="30-50"></td>
    <td align="center" valign="middle"><img src="https://img.shields.io/badge/-50+-38bdf8?style=flat-square" alt="50+"></td>
  </tr>
</table>

## Install

```bash
pi install git:github.com/barkure/pi-tps
```

## License

[MIT](LICENSE)
