# nacholens

[English](README.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · **Français** · [中文](README.zh.md) · [한국어](README.ko.md)

Voyez ce qu'une IA a changé dans un backend, sans lire le code. nacholens transforme un dépôt en une seule page : choisissez un cas d'usage et regardez la requête passer du client à vos services, à la base de données et aux services tiers, les parties modifiées étant mises en évidence à partir de `git diff`.

![nacholens : une requête traverse la boutique de démonstration, parties modifiées en évidence](docs/images/overview.png)

## Utilisation

Ouvrez votre agent de code IA (Claude Code, Codex, Cursor, …) dans le dépôt que vous voulez voir, copiez le bloc ci-dessous, écrivez votre demande sur la ligne `Ma demande :` et collez-le.

```text
Utilise nacholens pour répondre à ma demande ci-dessous sur ce dépôt, sous la forme d'une page que je peux ouvrir.

Ma demande : <écrivez ici ce que vous voulez voir>
Profondeur (facultatif) : 1 changements seuls · 2 vue d'ensemble · 3 détaillé (tables et intérieur). Sans précision, choisis selon ma demande et dis-moi laquelle.

Comment :
1. Récupère le guide d'agent et la CLI de nacholens (Node.js 20+, vérifié avec Node 24, et git nécessaires ; rien n'est installé dans ce dépôt) :
   npx -y @mafianacho/nacholens@latest install --to "$HOME/.nacholens-skill" --force
2. Lis "$HOME/.nacholens-skill/nacholens/SKILL.md" et suis-le. La CLI est :
   node "$HOME/.nacholens-skill/nacholens/cli/src/cli.js" <command>
3. Ne modifie aucun fichier de ce dépôt, sauf le modèle dans .nacholens/. Écris la page dans ./nacholens-out.
4. Une fois la page générée, donne-moi son chemin et explique simplement ce qu'elle montre.
```

Exemples de demandes:

- `Qu'est-ce qui a changé dans les 5 derniers commits, et que dois-je retester ?`
- `Montre comment fonctionne la connexion, du navigateur à la base de données.`
- `Compare cette branche avec main : quels parcours ce travail a-t-il touchés ?`

## Essayer la démo

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (à ouvrir dans un navigateur)
```

## Plus

- [Guide](docs/guide.md) (en anglais) : commandes, fonctionnement de la vue des changements, limites
- [Guide d'agent](skills/nacholens/SKILL.md), [format du modèle](docs/model-schema.md), [panneau de revue](docs/review.md)
- [Contribuer](CONTRIBUTING.md), [Sécurité](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). Les polices intégrées sont sous SIL Open Font License 1.1 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
