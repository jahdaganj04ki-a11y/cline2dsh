/**
 * Settings → Plugins → Cline Free.
 *
 * The Models page can only configure providers whose settings namespace it
 * recognises, and a third-party namespace is deliberately out of its editor's
 * scope, so the Cline token is entered here instead. The provider itself is
 * registered with the LLM registry and therefore appears in the model picker
 * like any other route.
 *
 * Built as one plain ESM module: no JSX, no bundler.
 */
window.__ModuleLoader__.load({
  id: 'dsh-cline-free',
  factory: require => {
    const React = require('react')
    const h = React.createElement
    const NS = 'clineFree'

    const en = {
      title: 'Cline Free',
      description: "Use Cline's rotating free models in DSH Desktop. Requires a Cline account.",
      loading: 'Loading settings…',
      reload: 'Reload',
      loadFailed: 'The saved settings could not be read. Reload before changing anything.',
      token: 'Cline token',
      tokenPlaceholder: 'workos:… · a JWT · refresh:… · or a token bundle (JSON)',
      tokenHelp:
        'Paste a Cline access token, a token bundle such as {"accessToken":…,"refreshToken":…}, or a refresh token as "refresh: …". Nothing is shown back to you after saving.',
      tokenSaved: 'A token is saved. Paste a new one to replace it.',
      save: 'Save',
      saving: 'Checking with Cline…',
      saved: 'Saved. Cline accepted the token.',
      status: 'Status',
      notConfigured: 'No token saved yet.',
      configured: 'Connected',
      account: 'Account',
      tokenKind: 'Token type',
      expires: 'Expires',
      never: 'unknown',
      readOnly: 'The credential store is read-only; these settings are managed elsewhere.',
      useCli: 'Use the Cline CLI login on this machine',
      usingCli: 'Use the CLI login instead',
      cliHint: 'A Cline CLI login was found on this machine. It can be adopted without opening a browser.',
      remove: 'Remove token',
      removing: 'Removing…',
      refreshModels: 'Refresh model list',
      refreshing: 'Refreshing…',
      modelsTitle: 'Free models right now',
      modelsHint: 'Live from Cline. Context, output, vision and reasoning come from the public Cline catalog per model.',
      source: 'Source',
      sourceLive: 'live',
      sourceCache: 'cached',
      sourceFallback: 'bundled fallback',
      fetched: 'Updated',
      model: 'Model',
      context: 'Context',
      output: 'Max output',
      vision: 'Vision',
      visionYes: 'yes',
      visionNo: 'no',
      reasoning: 'Reasoning',
      reasoningNone: 'not offered',
      test: 'Send a test message',
      testing: 'Sending…',
      testOk: 'Cline answered:',
      emptyModels: 'No free models are known yet. Refresh the list.',
      paid: 'billed',
    }
    const de = {
      title: 'Cline Free',
      description: 'Clines rotierende Gratismodelle in DSH Desktop nutzen. Erfordert ein Cline-Konto.',
      loading: 'Einstellungen werden geladen…',
      reload: 'Neu laden',
      loadFailed: 'Die gespeicherten Einstellungen konnten nicht gelesen werden. Vor Änderungen neu laden.',
      token: 'Cline-Token',
      tokenPlaceholder: 'workos:… · ein JWT · refresh:… · oder ein Token-Bundle (JSON)',
      tokenHelp:
        'Cline-Zugriffstoken, ein Token-Bundle wie {"accessToken":…,"refreshToken":…} oder ein Refresh-Token als „refresh: …“ einfügen. Nach dem Speichern wird nichts zurückgezeigt.',
      tokenSaved: 'Ein Token ist gespeichert. Zum Ersetzen ein neues einfügen.',
      save: 'Speichern',
      saving: 'Prüfe bei Cline…',
      saved: 'Gespeichert. Cline hat das Token akzeptiert.',
      status: 'Status',
      notConfigured: 'Noch kein Token gespeichert.',
      configured: 'Verbunden',
      account: 'Konto',
      tokenKind: 'Token-Typ',
      expires: 'Gültig bis',
      never: 'unbekannt',
      readOnly: 'Der Zugangsspeicher ist schreibgeschützt; diese Einstellungen werden anderswo verwaltet.',
      useCli: 'Cline-CLI-Anmeldung dieses Rechners übernehmen',
      usingCli: 'Stattdessen CLI-Anmeldung verwenden',
      cliHint: 'Auf diesem Rechner wurde eine Cline-CLI-Anmeldung gefunden. Sie kann ohne Browser übernommen werden.',
      remove: 'Token entfernen',
      removing: 'Entfernen…',
      refreshModels: 'Modellliste aktualisieren',
      refreshing: 'Aktualisieren…',
      modelsTitle: 'Aktuelle Gratismodelle',
      modelsHint: 'Live von Cline. Kontext, Ausgabe, Vision und Reasoning stammen pro Modell aus dem öffentlichen Cline-Katalog.',
      source: 'Quelle',
      sourceLive: 'live',
      sourceCache: 'zwischengespeichert',
      sourceFallback: 'eingebaute Notliste',
      fetched: 'Stand',
      model: 'Modell',
      context: 'Kontext',
      output: 'Max. Ausgabe',
      vision: 'Vision',
      visionYes: 'ja',
      visionNo: 'nein',
      reasoning: 'Reasoning',
      reasoningNone: 'nicht angeboten',
      test: 'Testnachricht senden',
      testing: 'Senden…',
      testOk: 'Cline antwortete:',
      emptyModels: 'Noch keine Gratismodelle bekannt. Liste aktualisieren.',
      paid: 'kostenpflichtig',
    }
    const zh = {
      title: 'Cline Free',
      description: '在 DSH Desktop 中使用 Cline 的免费模型，需要一个 Cline 账号。',
      loading: '正在读取配置…',
      reload: '重新读取',
      loadFailed: '无法读取已保存的配置，请先重新读取。',
      token: 'Cline 令牌',
      tokenPlaceholder: 'workos:… · JWT · refresh:… · 或令牌 JSON',
      tokenHelp: '粘贴 Cline 访问令牌、令牌 JSON（如 {"accessToken":…,"refreshToken":…}），或以 "refresh: …" 开头的刷新令牌。保存后不会回显。',
      tokenSaved: '已保存令牌，粘贴新的可以替换。',
      save: '保存',
      saving: '正在向 Cline 校验…',
      saved: '已保存，Cline 接受了该令牌。',
      status: '状态',
      notConfigured: '尚未保存令牌。',
      configured: '已连接',
      account: '账号',
      tokenKind: '令牌类型',
      expires: '过期时间',
      never: '未知',
      readOnly: '凭据存储为只读，这些设置由管理员管理。',
      useCli: '使用本机的 Cline CLI 登录',
      usingCli: '改用 CLI 登录',
      cliHint: '本机检测到 Cline CLI 登录，无需浏览器即可采用。',
      remove: '删除令牌',
      removing: '正在删除…',
      refreshModels: '刷新模型列表',
      refreshing: '正在刷新…',
      modelsTitle: '当前的免费模型',
      modelsHint: '实时来自 Cline。上下文、输出、视觉与推理等级按模型取自 Cline 公开目录。',
      source: '来源',
      sourceLive: '实时',
      sourceCache: '缓存',
      sourceFallback: '内置兜底',
      fetched: '更新于',
      model: '模型',
      context: '上下文',
      output: '最大输出',
      vision: '视觉',
      visionYes: '支持',
      visionNo: '不支持',
      reasoning: '推理',
      reasoningNone: '不提供',
      test: '发送测试消息',
      testing: '正在发送…',
      testOk: 'Cline 返回：',
      emptyModels: '暂无已知免费模型，请刷新列表。',
      paid: '计费',
    }

    const css = `
      /* Mirrors the host PluginCard contract (its component is internal). */
      .dshClineCard{list-style:none;border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;transition:border-color .16s,background .16s}
      .dshClineCard:hover{border-color:var(--dsw-alias-label-dimmed)}.dshClineCardOpen{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}
      .dshClineHeader{appearance:none;display:flex;align-items:center;gap:12px;width:100%;padding:14px 16px;background:transparent;border:0;border-radius:12px;text-align:left;color:inherit;font:inherit;cursor:pointer}
      .dshClineHeading{display:flex;flex:1;flex-direction:column;gap:4px;min-width:0}
      .dshClineTitle{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}
      .dshClineDot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
      .dshClineDotOn{background:var(--dsw-alias-state-success-primary,#2f9e5f)}
      .dshClineDescription{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}
      .dshClineBody{border-top:.5px solid var(--dsw-alias-border-l2);margin:0 16px;padding-bottom:8px;display:flex;flex-direction:column;gap:12px}
      .dshClineField{display:flex;flex-direction:column;gap:6px;padding:12px 0;font-size:13px;font-weight:500;line-height:1.5;color:var(--dsw-alias-label-primary)}
      .dshClineField+.dshClineField{border-top:.5px solid var(--dsw-alias-border-l2)}
      .dshClineField textarea{box-sizing:border-box;width:100%;min-height:76px;padding:8px 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:8px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);font:inherit;font-weight:400;resize:vertical;word-break:break-all}
      .dshClineHint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-tertiary);margin:0}
      .dshClineActions{display:flex;justify-content:flex-end;align-items:center;gap:8px;padding:12px 0 4px;flex-wrap:wrap}
      .dshClinePrimary{appearance:none;font:inherit;font-size:13px;line-height:1.5;border:1px solid transparent;border-radius:8px;padding:5px 14px;background:var(--dsw-alias-label-primary);color:var(--dsw-alias-bg-layer-3);cursor:pointer}
      .dshClinePrimary:disabled{opacity:.4;cursor:default}
      .dshClineSecondary{appearance:none;font:inherit;font-size:13px;line-height:1.5;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:5px 14px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
      .dshClineSecondary:disabled{opacity:.4;cursor:default}
      .dshClineStatus{margin:0;font-size:12px;line-height:1.5}
      .dshClineError{color:var(--dsw-alias-state-error-primary)}
      .dshClineMeta{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-tertiary);margin:0}
      .dshClineMeta b{color:var(--dsw-alias-label-secondary);font-weight:500}
      .dshClineTableWrap{overflow-x:auto;max-width:100%}
      .dshClineTable{border-collapse:collapse;width:100%;font-size:12px;line-height:1.5}
      .dshClineTable th,.dshClineTable td{text-align:left;padding:6px 10px 6px 0;border-bottom:.5px solid var(--dsw-alias-border-l2);white-space:nowrap;vertical-align:top}
      .dshClineTable th{color:var(--dsw-alias-label-tertiary);font-weight:500}
      .dshClineTable td{color:var(--dsw-alias-label-secondary)}
      .dshClineTable td.dshClineId{white-space:normal;min-width:14ch;word-break:break-all}
      .dshClineBadge{display:inline-block;margin-left:6px;padding:0 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-tertiary);font-size:11px}
      .dshClineCard :focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
      .dshClineHeader:focus-visible{outline-offset:-2px}
    `

    const compact = value => {
      if (!Number.isFinite(value)) return '—'
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
      if (value >= 1_000) return `${Math.round(value / 1000)}K`
      return String(value)
    }

    const when = value => {
      if (typeof value !== 'number') return null
      const date = new Date(value)
      if (Number.isNaN(date.getTime())) return null
      return date.toLocaleString()
    }

    function ClineCard({ t, callApi }) {
      const [expanded, setExpanded] = React.useState(false)
      const [state, setState] = React.useState(null)
      const [loadFailed, setLoadFailed] = React.useState(false)
      const [token, setToken] = React.useState('')
      const [busy, setBusy] = React.useState('')
      const [error, setError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [testResult, setTestResult] = React.useState('')
      const lifetime = React.useRef(null)

      React.useEffect(() => {
        lifetime.current = new AbortController()
        return () => lifetime.current?.abort()
      }, [])

      const load = React.useCallback(async () => {
        setLoadFailed(false)
        try {
          setState(await callApi('settings', undefined, lifetime.current?.signal))
        } catch {
          setLoadFailed(true)
        }
      }, [callApi])

      React.useEffect(() => {
        if (expanded && !state) void load()
      }, [expanded, state, load])

      const run = async (label, endpoint, payload, onDone) => {
        setBusy(label)
        setError('')
        setStatus('')
        setTestResult('')
        try {
          const next = await callApi(endpoint, payload, lifetime.current?.signal)
          setState(next)
          if (onDone) onDone(next)
          return next
        } catch (cause) {
          setError(cause?.error ?? cause?.message ?? String(cause))
          return undefined
        } finally {
          setBusy('')
        }
      }

      const save = async () => {
        const next = await run('save', 'token', { token })
        if (next) {
          setToken('')
          setStatus('saved')
        }
      }

      const models = state?.models ?? []
      const account = state?.account ?? {}
      const configured = account.configured === true || account.envConfigured === true
      const writable = account.writable !== false

      return h(
        'li',
        { className: `dshClineCard${expanded ? ' dshClineCardOpen' : ''}` },
        h(
          'button',
          {
            type: 'button',
            className: 'dshClineHeader',
            'aria-expanded': expanded,
            onClick: () => setExpanded(value => !value),
          },
          h('span', { className: `dshClineDot${configured ? ' dshClineDotOn' : ''}` }),
          h(
            'span',
            { className: 'dshClineHeading' },
            h('span', { className: 'dshClineTitle' }, t('title')),
            h('span', { className: 'dshClineDescription' }, t('description')),
          ),
        ),
        expanded &&
          h(
            'div',
            { className: 'dshClineBody' },
            state === null
              ? h(
                  'div',
                  { className: 'dshClineField' },
                  h('p', { className: 'dshClineStatus' }, t('loading')),
                  loadFailed &&
                    h(
                      'div',
                      { className: 'dshClineActions' },
                      h('p', { className: 'dshClineStatus dshClineError', role: 'alert' }, t('loadFailed')),
                      h('button', { type: 'button', className: 'dshClineSecondary', onClick: load }, t('reload')),
                    ),
                )
              : h(
                  React.Fragment,
                  null,
                  h(
                    'div',
                    { className: 'dshClineField' },
                    h('span', null, t('status')),
                    h(
                      'p',
                      { className: 'dshClineMeta' },
                      h('b', null, `${t('status')}: `),
                      configured ? t('configured') : t('notConfigured'),
                      account.email ? h('span', null, `${t('account')}: ${account.email}`) : null,
                      account.label ? h('span', null, `${t('tokenKind')}: ${account.label}`) : null,
                      h(
                        'span',
                        null,
                        `${t('expires')}: ${when(account.expiresAt) ?? t('never')}`,
                      ),
                    ),
                    !writable && h('p', { className: 'dshClineHint' }, t('readOnly')),
                  ),
                  h(
                    'div',
                    { className: 'dshClineField' },
                    h('span', null, t('token')),
                    h('textarea', {
                      value: token,
                      disabled: !writable,
                      placeholder: configured ? t('tokenSaved') : t('tokenPlaceholder'),
                      onChange: event => setToken(event.target.value),
                      spellCheck: false,
                      autoComplete: 'off',
                    }),
                    h('p', { className: 'dshClineHint' }, t('tokenHelp')),
                    h(
                      'div',
                      { className: 'dshClineActions' },
                      h(
                        'button',
                        { type: 'button', className: 'dshClinePrimary', disabled: !writable || !token.trim() || busy !== '', onClick: save },
                        t(busy === 'save' ? 'saving' : 'save'),
                      ),
                      account.cliAvailable === true &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshClineSecondary',
                            disabled: !writable || busy !== '',
                            onClick: () => run('cli', 'import', undefined, () => setStatus('saved')),
                          },
                          t(busy === 'cli' ? 'saving' : 'useCli'),
                        ),
                      configured &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshClineSecondary',
                            disabled: !writable || busy !== '',
                            onClick: () => run('remove', 'logout'),
                          },
                          t(busy === 'remove' ? 'removing' : 'remove'),
                        ),
                      configured &&
                        models.length > 0 &&
                        h(
                          'button',
                          {
                            type: 'button',
                            className: 'dshClineSecondary',
                            disabled: busy !== '',
                            onClick: async () => {
                              const next = await run('test', 'test', { model: models[0].id })
                              if (next) setTestResult(`${t('testOk')} ${String(next.content ?? '').slice(0, 120)}`)
                            },
                          },
                          t(busy === 'test' ? 'testing' : 'test'),
                        ),
                    ),
                    account.cliAvailable === true &&
                      h(
                        'p',
                        { className: 'dshClineHint' },
                        account.cliEmail ? `${t('cliHint')} (${account.cliEmail})` : t('cliHint'),
                      ),
                    status && h('p', { className: 'dshClineStatus', role: 'status' }, t(status)),
                    testResult && h('p', { className: 'dshClineStatus', role: 'status' }, testResult),
                    error && h('p', { className: 'dshClineStatus dshClineError', role: 'alert' }, error),
                  ),
                  h(
                    'div',
                    { className: 'dshClineField' },
                    h('span', null, t('modelsTitle')),
                    h('p', { className: 'dshClineHint' }, t('modelsHint')),
                    models.length === 0
                      ? h('p', { className: 'dshClineStatus' }, t('emptyModels'))
                      : h(
                          'div',
                          { className: 'dshClineTableWrap' },
                          h(
                            'table',
                            { className: 'dshClineTable' },
                            h(
                              'thead',
                              null,
                              h(
                                'tr',
                                null,
                                h('th', null, t('model')),
                                h('th', null, t('context')),
                                h('th', null, t('output')),
                                h('th', null, t('vision')),
                                h('th', null, t('reasoning')),
                              ),
                            ),
                            h(
                              'tbody',
                              null,
                              models.map(model =>
                                h(
                                  'tr',
                                  { key: model.id },
                                  h(
                                    'td',
                                    { className: 'dshClineId' },
                                    model.name,
                                    model.paid ? h('span', { className: 'dshClineBadge' }, t('paid')) : null,
                                    h('br'),
                                    h('span', { className: 'dshClineHint' }, model.id),
                                  ),
                                  h('td', null, compact(model.contextWindow)),
                                  h('td', null, compact(model.maxTokens)),
                                  h('td', null, model.vision ? t('visionYes') : t('visionNo')),
                                  h('td', null, model.efforts?.length ? model.efforts.join(' · ') : t('reasoningNone')),
                                ),
                              ),
                            ),
                          ),
                        ),
                    h(
                      'p',
                      { className: 'dshClineMeta' },
                      h('b', null, `${t('source')}: `),
                      state.source === 'live' ? t('sourceLive') : state.source === 'cache' ? t('sourceCache') : t('sourceFallback'),
                      state.fetchedAt ? h('span', null, `${t('fetched')}: ${when(state.fetchedAt)}`) : null,
                    ),
                    h(
                      'div',
                      { className: 'dshClineActions' },
                      h(
                        'button',
                        { type: 'button', className: 'dshClineSecondary', disabled: busy !== '', onClick: () => run('refresh', 'refresh') },
                        t(busy === 'refresh' ? 'refreshing' : 'refreshModels'),
                      ),
                    ),
                  ),
                ),
          ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const callApi = async (endpoint, payload, signal) => {
          const isRead = endpoint === 'settings'
          const response = await fetch(`/api/cline-free.${endpoint}`, {
            method: isRead ? 'GET' : 'POST',
            credentials: 'same-origin',
            cache: 'no-store',
            signal,
            ...(isRead
              ? {}
              : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload ?? {}) }),
          })
          const text = await response.text()
          let data
          try {
            data = text ? JSON.parse(text) : {}
          } catch {
            throw { error: 'The plugin returned an unreadable response.' }
          }
          if (!response.ok) throw data
          return data
        }

        ctx.effect(() => ctx.locale.register(NS, { zh, en, de }), 'cline-free locale')
        ctx.effect(
          () => {
            const style = document.createElement('style')
            style.dataset.pluginCss = 'dsh-cline-free'
            style.textContent = css
            document.head.appendChild(style)
            return () => style.remove()
          },
          'cline-free styles',
        )
        const t = ctx.locale.bind(NS)
        ctx.slots.inject('settings.plugins.tab', () =>
          ctx.slots.register(
            {
              name: 'settings.plugins.tab',
              id: 'cline-free',
              order: -95,
              locale: NS,
              label: () => t('title'),
              inject: () => ({ callApi }),
            },
            ClineCard,
          ),
        )
      },
    }
  },
})
