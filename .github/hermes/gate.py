#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Gate Hermes Lite — fraîcheur exigée AU MOMENT DU MERGE ([HERMES-REFRESH], porté du gate `duello`).

Règles :
- retard sans conflit  → rebase serveur (PUT /pulls/N/update-branch) ;
  le rebase déclenche un événement `synchronize` qui re-run ce workflow → cycle auto.
- vrai conflit         → check rouge + label `hermes/conflit` (escalade humaine).
- frais + checks requis verts → merge (rebase), une PR à la fois.
"""

API = 'https://api.github.com'
CHECK_NAME = 'hermes-lite/verdict'
LABEL_OK = 'hermes/approuvee'
LABEL_CONFLIT = 'hermes/conflit'

import json
import time


def api(method, url, body=None, token=None):
    import json as _json
    import urllib.request as _ur
    import urllib.error as _ue
    data = _json.dumps(body).encode() if body is not None else None
    req = _ur.Request(API + url, data=data, method=method)
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Accept', 'application/vnd.github+json')
    try:
        with _ur.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (_json.loads(raw) if raw else None)
    except _ue.HTTPError as e:
        payload = e.read()
        try:
            return e.code, _json.loads(payload)
        except Exception:
            return e.code, payload.decode('utf-8', errors='replace')


def ensure_label(repo, token, name, color, desc):
    api('POST', '/repos/%s/labels' % repo, token=token,
        body={'name': name, 'color': color, 'description': desc})


def set_label(pr, repo, token, name, add):
    num = pr['number']
    has = name in [l['name'] for l in pr.get('labels') or []]
    if add and not has:
        api('POST', '/repos/%s/issues/%d/labels' % (repo, num),
            token=token, body={'labels': [name]})
    elif not add and has:
        api('DELETE', '/repos/%s/issues/%d/labels/%s' % (repo, num, name),
            token=token)


def refresh_branch(repo, token, pr):
    """Rebase serveur d'une PR en retard. Renvoie 'refreshed'/'conflict'/'error'."""
    num = pr['number']
    expected = pr['head']['sha']
    sc, resp = api('PUT', '/repos/%s/pulls/%d/update-branch' % (repo, num),
                   token=token,
                   body={'update_method': 'rebase', 'expected_head_sha': expected})
    if sc == 202:
        return 'refreshed'
    if sc in (409, 422):
        return 'conflict'
    print('[gate] #%d update-branch %s : %s' % (num, sc, resp), flush=True)
    return 'error'


def approve_pending_runs(repo, token, pr, sha):
    """Approuve les runs `action_required` d'une branche rafraichie.

    Un push de bot (le rebase serveur) ne declenche pas la CI : GitHub met les
    runs en attente d'approbation. Sans cette etape, la branche fraiche n'a
    aucun check rattache a la PR et le merge est refuse (405, "N of N required
    status checks are expected"). Constate le 2026-11-11 sur ce depot.

    Refuse d'approuver quoi que ce soit pour une PR venant d'un fork : on
    n'approuve que nos propres workflows sur nos propres branches.
    """
    head_repo = (pr.get('head') or {}).get('repo') or {}
    if head_repo.get('fork'):
        return 0
    sc, data = api('GET', '/repos/%s/actions/runs?head_sha=%s' % (repo, sha), token=token)
    if sc != 200 or not data:
        return 0
    approved = 0
    for run in data.get('workflow_runs') or []:
        if run.get('conclusion') != 'action_required':
            continue
        sc2, resp = api('POST', '/repos/%s/actions/runs/%s/approve' % (repo, run['id']),
                        token=token)
        if sc2 in (200, 201, 202, 204):
            approved += 1
        else:
            print('[gate] approve run %s : %s %s' % (run['id'], sc2, resp), flush=True)
    if approved:
        print('[gate] #%d : %d run(s) approuve(s)' % (pr['number'], approved), flush=True)
    return approved


def create_check(repo, token, sha, ok, title, summary):
    api('POST', '/repos/%s/check-runs' % repo, token=token, body={
        'name': CHECK_NAME,
        'head_sha': sha,
        'status': 'completed',
        'conclusion': 'success' if ok else 'failure',
        'output': {'title': title, 'summary': summary},
    })


def required_checks_green(repo, token, pr, required):
    """Checks requis verts. Liste vide => considéré vert.

    GitHub Actions publie des *check-runs*, pas des statuts de commit : on
    lit donc les check-runs (nom du job, conclusion) et, en repli, les statuts
    classiques pour les vérifications externes.
    """
    if not required:
        return True
    sha = pr['head']['sha']
    states = {}
    sc, data = api('GET', '/repos/%s/commits/%s/check-runs' % (repo, sha), token=token)
    if sc == 200:
        for run in data.get('check_runs') or []:
            states[run.get('name')] = run.get('conclusion')
    sc, data = api('GET', '/repos/%s/commits/%s/status' % (repo, sha), token=token)
    if sc == 200:
        for status in data.get('statuses') or []:
            states.setdefault(status.get('context'), status.get('state'))
    for ctx in required:
        if states.get(ctx) not in ('success', 'neutral', 'skipped'):
            return False
    return True


def settle_after_refresh(repo, token, num, required, attempts=20, pause=6, dry=False):
    """[HERMES-REFRESH] Ré-évalue la PR après le rebase serveur, DANS CE RUN.

    Le push effectué par `update-branch` est un push de bot : il ne déclenche
    AUCUN workflow (anti-récursion GitHub), et hermes-lite n'a ni cron ni
    dispatch possible avec GITHUB_TOKEN. Sans cette boucle, une PR rebasée
    resterait ouverte pour toujours : personne ne la re-évaluerait.
    Pollue borné (~120 s), puis rend la main (la veille événementielle
    rattrapera au prochain check_run de ce head).
    """
    for i in range(attempts):
        time.sleep(pause if i else 2)
        sc, pr = api('GET', '/repos/%s/pulls/%d' % (repo, num), token=token)
        if sc != 200 or not isinstance(pr, dict):
            continue
        if pr.get('merged'):
            return 'merged'
        sha = pr['head']['sha']
        base_ref = pr['base']['ref']
        sc, cmp_ = api('GET', '/repos/%s/compare/%s...%s' % (repo, base_ref, sha),
                       token=token)
        behind = cmp_.get('behind_by') if sc == 200 else -1
        behind = behind if isinstance(behind, int) else -1
        if behind > 0:
            continue  # rebase pas encore appliqué (ou main a bougé entre-temps)
        conflicts = (pr.get('mergeable') is False
                     and (pr.get('mergeable_state') or '') == 'dirty')
        if conflicts:
            create_check(repo, token, sha, False,
                         'Conflits avec %s — intervention humaine' % base_ref,
                         'Le rebase automatique a révélé un conflit. Rebase manuel '
                         'puis push, ou label `hermes/intervention-humaine`.')
            set_label(pr, repo, token, LABEL_CONFLIT, True)
            set_label(pr, repo, token, LABEL_OK, False)
            return 'conflict'
        set_label(pr, repo, token, LABEL_OK, True)
        create_check(repo, token, sha, True, 'PR à jour — merge par le gate',
                     'Fraîche au moment du merge (settle après rebase serveur).')
        if dry:
            return 'dry'
        m = try_merge(repo, token, pr, required)
        print('[gate] #%d : settle merge → %s' % (num, m), flush=True)
        if m != 'waiting':
            return m
    return 'timeout'


def try_merge(repo, token, pr, required):
    """Merge la PR (méthode rebase) si fraîche et checks requis verts."""
    num = pr['number']
    sha = pr['head']['sha']
    # Re-vérification de fraîcheur au dernier moment (défense anti-course)
    sc, cmp_ = api('GET', '/repos/%s/compare/%s...%s'
                   % (repo, pr['base']['ref'], sha), token=token)
    if sc == 200 and cmp_.get('behind_by') not in (0, None):
        return 'behind'
    if not required_checks_green(repo, token, pr, required):
        return 'waiting'
    sc, resp = api('PUT', '/repos/%s/pulls/%d/merge' % (repo, num), token=token,
                   body={'sha': sha, 'merge_method': 'rebase'})
    if sc == 200:
        return 'merged'
    if sc == 409:
        return 'behind'
    print('[gate] #%d merge %s : %s' % (num, sc, resp), flush=True)
    return 'error'


def raise_conflict(pr, repo, token, base_ref, detail):
    """Check rouge + label d'escalade. Le gate ne résout rien : il signale."""
    create_check(repo, token, pr['head']['sha'], False,
                 'Conflits avec %s — intervention humaine' % base_ref, detail)
    set_label(pr, repo, token, LABEL_CONFLIT, True)
    set_label(pr, repo, token, LABEL_OK, False)


def refresh_and_settle(repo, token, pr, num, behind, base_ref, required):
    """Rebase serveur d'une PR en retard, puis ré-évaluation dans le même run.

    Le push du rebase est un push de bot : la CI part en attente d'approbation.
    On approuve — sur la NOUVELLE tête, pas celle lue en début de run, sinon la
    requête ne trouve aucun run — puis on laisse `settle_after_refresh` attendre
    les checks.
    """
    r = refresh_branch(repo, token, pr)
    print('[gate] #%d : en retard de %s → refresh %s' % (num, behind, r), flush=True)
    if r == 'refreshed':
        sc, fresh = api('GET', '/repos/%s/pulls/%d' % (repo, num), token=token)
        new_pr = fresh if sc == 200 and fresh else pr
        new_sha = (new_pr.get('head') or {}).get('sha') or pr['head']['sha']
        approve_pending_runs(repo, token, new_pr, new_sha)
        return settle_after_refresh(repo, token, num, required)
    if r == 'conflict':
        raise_conflict(pr, repo, token, base_ref,
                       'Le rebase automatique a été refusé. Rebase manuel '
                       'puis push, ou label `hermes/intervention-humaine`.')
    return r


def refresh_mergeable(repo, token, pr, attempts=4, pause=2):
    """Récupère `mergeable` / `mergeable_state` sur le DÉTAIL de la PR.

    Deux pièges mesurés le 2026-11-11 sur la PR #29 (conflit réel, `dirty`) :
    - l'endpoint liste `GET /pulls?state=open` ne renvoie **pas** ces champs,
      donc un gate déclenché par `workflow_dispatch` ou `check_run` ne voyait
      jamais aucun conflit et ne dispatchait jamais le résolveur ;
    - GitHub calcule `mergeable` à la demande : le premier appel renvoie `null`.
      D'où les quelques tentatives espacées.
    """
    num = pr['number']
    fresh = dict(pr)
    for _ in range(attempts):
        sc, detail = api('GET', '/repos/%s/pulls/%d' % (repo, num), token=token)
        if sc == 200 and detail:
            for key in ('mergeable', 'mergeable_state', 'head', 'base', 'draft'):
                if detail.get(key) is not None:
                    fresh[key] = detail[key]
            if fresh.get('mergeable') is not None:
                return fresh
        time.sleep(pause)
    return fresh


def handle_pr(pr, repo, token, required, dry=False):
    pr = refresh_mergeable(repo, token, pr)
    num = pr['number']
    sha = pr['head']['sha']
    # Un push de bot (rebase serveur, mais aussi push du résolveur) met la CI en
    # attente d'approbation : sans check, la protection de branche répond 405 et
    # Mergify attend pour toujours. On approuve à chaque évaluation, pas
    # seulement juste après notre propre rebase.
    approve_pending_runs(repo, token, pr, sha)
    base_ref = pr['base']['ref']
    mergeable = pr.get('mergeable')           # None = calcul en cours
    mergeable_state = pr.get('mergeable_state') or ''

    sc, cmp_ = api('GET', '/repos/%s/compare/%s...%s' % (repo, base_ref, sha),
                   token=token)
    behind = cmp_.get('behind_by') if sc == 200 else -1
    behind = behind if isinstance(behind, int) else -1
    fresh = behind == 0
    conflicts = (mergeable is False and mergeable_state == 'dirty')

    if conflicts:
        raise_conflict(pr, repo, token, base_ref,
                       'Le gate ne résout pas les conflits : il dispatche le '
                       'résolveur Hermes (hermes-conflict-resolver.yml). Sans '
                       'résolution, rebase manuel puis push.')
        return 'conflict'
    set_label(pr, repo, token, LABEL_CONFLIT, False)

    if not fresh:
        if dry:
            print('[gate] #%d : en retard de %s commit(s) — rebase serveur (dry-run)' % (num, behind))
            return 'dry'
        return refresh_and_settle(repo, token, pr, num, behind, base_ref, required)

    set_label(pr, repo, token, LABEL_OK, True)
    create_check(repo, token, sha, True,
                 'PR à jour — merge par le gate',
                 'Fraîche au moment du merge ; %s' %
                 ('checks requis verts' if required else 'aucun check requis configuré'))
    if dry:
        print('[gate] #%d : fraîche — merge possible (dry-run)' % num)
        return 'dry'
    m = try_merge(repo, token, pr, required)
    print('[gate] #%d : merge → %s' % (num, m), flush=True)
    return m


def list_open_prs(repo, token):
    prs, page = [], 1
    while True:
        sc, plist = api('GET', '/repos/%s/pulls?state=open&per_page=100&page=%d'
                        % (repo, page), token=token)
        if sc != 200 or not isinstance(plist, list):
            break
        prs += plist
        if len(plist) < 100:
            break
        page += 1
    return prs


def main():
    import os
    token = os.environ['GH_TOKEN']
    repo = os.environ['GITHUB_REPOSITORY']
    event_name = os.environ['GITHUB_EVENT_NAME']
    required = [s.strip() for s in
                os.environ.get('HERMES_REQUIRED_CHECKS', '').split(',') if s.strip()]
    dry = os.environ.get('HERMES_LITE_DRY_RUN') == '1'

    for lbl in (LABEL_OK, LABEL_CONFLIT):
        ensure_label(repo, token, lbl, '0e8a16' if lbl == LABEL_OK else 'd73a4a',
                     'Posé par hermes-lite')

    with open(os.environ['GITHUB_EVENT_PATH']) as fh:
        event = json.load(fh)

    if event_name == 'workflow_dispatch':
        only = (event.get('inputs') or {}).get('pr_number') or None
        prs = list_open_prs(repo, token)
        if only:
            prs = [p for p in prs if p['number'] == int(only)]
    elif event_name == 'pull_request':
        prs = [event['pull_request']]
    elif event_name == 'check_run':
        # Un check vient de finir : ré-évalue les PR dont le head porte ce check.
        sha = event['check_run']['head_sha']
        prs = [p for p in list_open_prs(repo, token)
               if p['head']['sha'] == sha]
    else:
        prs = []

    merged = 0
    conflicts = []
    for pr in prs:
        if pr.get('draft') or pr.get('state') != 'open':
            continue
        try:
            r = handle_pr(pr, repo, token, required, dry)
            if r == 'merged':
                merged += 1
            elif r == 'conflict':
                conflicts.append(pr['number'])
        except Exception as e:
            print('[gate] #%s exception : %r' % (pr.get('number'), e), flush=True)
    # Sortie machine pour le workflow : les PR en VRAI conflit, pour que l'étape
    # suivante dispatche le résolveur (hermes-conflict-resolver.yml).
    out_path = os.environ.get('GITHUB_OUTPUT')
    if out_path:
        with open(out_path, 'a', encoding='utf-8') as fh:
            fh.write('conflict_prs=%s\n' % ','.join(str(n) for n in conflicts))
    print('[gate] terminé : %d PR traitée(s), %d merge(s), conflits %s'
          % (len(prs), merged, conflicts or 'aucun'), flush=True)


if __name__ == '__main__':
    main()
