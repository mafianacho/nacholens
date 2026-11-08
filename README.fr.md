# nacholens

[English](README.md) · [日本語](README.ja.md) · [Deutsch](README.de.md) · **Français** · [中文](README.zh.md) · [한국어](README.ko.md)

**Voyez ce qu'une IA a changé dans votre code, sans lire le code.**

![Avant : un mur de diff et trois questions. Après : nacholens montre la requête à travers les services, met en évidence le modifié et le nouveau, et y répond (légendes en anglais).](docs/images/blackbox-to-whitebox.gif)

Un agent IA modifie votre code et rend un long diff. Qu'a-t-il touché ? Appelle-t-il un service externe ? Que faut-il retester ? nacholens répond par une image à lire :

- **Choisissez ce que fait un utilisateur** (connexion, commande). Un point voyage du navigateur aux services, à la base de données et aux services externes, étape par étape.
- **Ce qui a changé est en couleur** : jaune = modifié, vert = nouveau.
- **Chaque étape renvoie au vrai code**, rien n'est deviné.

Pour les chefs de projet, testeurs et développeurs. Inutile de lire du code.

## À utiliser en 3 étapes

1. Ouvrez votre agent de code IA (Claude Code, Codex, Cursor, …) dans le projet.
2. Copiez le bloc ci-dessous, écrivez ce que vous voulez voir sur `Ma demande :` et collez-le.
3. Ouvrez la page que l'agent vous donne.

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

Ce que vous pouvez demander :

- `Qu'est-ce qui a changé dans les 5 derniers commits, et que dois-je retester ?`
- `Montre comment fonctionne la connexion, du navigateur à la base de données.`
- `Compare cette branche avec main : quels parcours ce travail a-t-il touchés ?`
- `Explique la PR #12 dans la PR elle-même : images, parcours modifiés et ce qu'il faut retester.`

## Dans votre pull request

nacholens écrit aussi **un commentaire dans la pull request**, compréhensible depuis la seule page de la PR : images des parcours modifiés, chaque étape en mots simples avec lien vers le code, une liste à retester et ce que les images ne couvrent pas. [Comment ça marche](docs/pr.md)

<img src="docs/images/pr-comment.png" alt="Commentaire nacholens sur une pull request (en anglais) : résumé, image des changements, premier parcours modifié" width="600">

## Essayer sans votre propre projet

```bash
npx -y @mafianacho/nacholens@latest demo
# → ./nacholens-demo/demo-shop.html (à ouvrir dans un navigateur)
```

## Bon à savoir

- Votre projet est seulement lu, jamais modifié. nacholens n'envoie rien sur le réseau.
- Ni compte ni serveur : seulement Node.js 20+ et git.

## Plus

[Guide](docs/guide.md) (en anglais) · [Guide d'agent](skills/nacholens/SKILL.md) · [Format du modèle](docs/model-schema.md) · [Panneau de revue](docs/review.md) · [Commentaire de PR](docs/pr.md) (en anglais) · [Contribuer](CONTRIBUTING.md) · [Sécurité](SECURITY.md)

Apache License 2.0 ([`LICENSE`](LICENSE), [`NOTICE`](NOTICE)). Polices intégrées : SIL Open Font License 1.1 ([`FONTLOG`](src/player/fonts/FONTLOG.md)). Made by [Mafianacho Inc.](https://mafianacho.com)
