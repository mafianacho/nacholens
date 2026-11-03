# nacholens

[English](README.md) · [日本語](README.ja.md) · **Deutsch** · [Français](README.fr.md) · [中文](README.zh.md) · [한국어](README.ko.md)

Sieh, was eine KI in einem Backend geändert hat, ohne Code zu lesen. nacholens macht aus einem Repository eine einzige Seite: Wähle einen Anwendungsfall und sieh, wie die Anfrage vom Client durch deine Dienste, die Datenbank und Drittanbieter läuft. Die geänderten Teile sind aus `git diff` hervorgehoben.

![nacholens: eine Anfrage läuft durch den Demo-Shop, geänderte Teile hervorgehoben](docs/images/overview.png)

## Verwendung

Öffne deinen KI-Coding-Agenten (Claude Code, Codex, Cursor, …) im Repository, das du sehen willst. Kopiere den Block unten, schreibe deine Anfrage in die Zeile `Meine Anfrage:` und füge ihn ein.

```text
Nutze nacholens, um meine Anfrage unten zu diesem Repository als Seite zu beantworten, die ich öffnen kann.

Meine Anfrage: <hier schreiben, was du sehen willst>

So geht's:
1. Hole das nacholens-Playbook und die CLI (braucht Node.js 20+ und git; in dieses Repository wird nichts installiert):
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. Lies "$HOME/.nacholens-skill/nacholens/SKILL.md" und folge ihm. Die CLI ist:
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. Ändere keine Datei dieses Repositorys außer dem Modell in .nacholens/. Schreibe die Seite nach ./nacholens-out.
4. Wenn die Seite fertig ist, nenne mir ihren Pfad und erkläre in einfachen Worten, was sie zeigt.
```

Beispielanfragen:

- `Was hat sich in den letzten 5 Commits geändert, und was sollte ich erneut testen?`
- `Zeig, wie die Anmeldung funktioniert, vom Browser bis zur Datenbank.`
- `Vergleiche diesen Branch mit main: Welche Abläufe hat diese Arbeit berührt?`

## Demo ausprobieren

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (im Browser öffnen)
```

## Mehr

- [Anleitung](docs/guide.md) (Englisch): Befehle, wie die Änderungsansicht funktioniert, Grenzen
- [Agenten-Playbook](skills/nacholens/SKILL.md), [Modellformat](docs/model-schema.md), [Review-Dock](docs/review.md)
- [Mitwirken](CONTRIBUTING.md), [Sicherheit](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). Die eingebetteten Schriften stehen unter der SIL Open Font License 1.1 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
