# College football predictions: published site

Live site: **https://cfb.sahilfarishta.com**

This repository holds the generated files that GitHub Pages serves for the site. It is a build output, not the project's source:
the model code and training data are not published here, and the files in this repository are overwritten each week.

## What the site shows

- **Games.** A forecast for every FBS game: predicted score, win probability and margin, next to the betting line for reference.
  Final scores appear once a game is played.
- **Rankings.** Team ratings and player rankings produced by the same neural network that makes the forecasts.
- **Simulated games.** Play-by-play and box scores for each game, simulated by the model. They are illustrations, not predictions of
  individual plays.
- **Postseason.** A simulated conference championship, 12-team playoff and bowl bracket.

The only real-world game results on the site are final scores. Every play-by-play and box score is simulated.

## How the numbers are made

A neural network learns player and team strength from past seasons and updates each week with the games played. Pre-game
availability reports (who is out or questionable) are applied to each lineup. Each game is then simulated many times with a
play-by-play model, and the forecast is built from those simulations. The model never reads a betting line; a separate
"market-blended" view moves the forecast part of the way toward the line. The site's About page describes the method and its limits.

## Files

| Path | Content |
|---|---|
| `index.html`, `app.js`, `style.css` | The single-page app (plain JavaScript, no build step) |
| `data/` | One JSON file per page and week; the app reads these instead of a server |
| `CNAME` | Custom domain for GitHub Pages |

Please do not scrape `data/` at high volume. If you want the data for something, get in touch instead.

## Credits and disclaimer

Schedules, final scores, rosters and betting lines come from [CollegeFootballData.com](https://collegefootballdata.com).
This is an independent, non-commercial project. It is not affiliated with or endorsed by the NCAA, any conference or any school.
Team names and logos belong to their owners and are used only to identify teams. Forecasts are published for information and
entertainment; they are not betting advice.
