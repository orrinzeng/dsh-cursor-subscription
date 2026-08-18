window.__ModuleLoader__.load({
	id: "dsh-cursor-subscription",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");

		//#region src/client.jsx
		const inject = ["slots", "locale", "connection"];
		const NS = "settings.cursorSubscription";
		const CHANNEL = "/cursor-subscription";

		const zh = {
			nav: "Cursor 订阅",
			title: "Cursor 订阅",
			connected: "已登录",
			disconnected: "未登录",
			accountLoading: "正在读取账户状态…",
			login: "浏览器登录",
			logout: "退出登录",
			cancel: "取消",
			openLogin: "打开登录页",
			waiting: "正在等待登录完成…",
			failed: "登录失败，请重试。",
			loadFailed: "无法读取 Cursor 状态。",
			note: "在浏览器中登录 Cursor 账户后，即可在模型选择器中使用 Cursor 订阅模型。登录信息仅保存在本机，不会上传。",
			expiresAt: "令牌有效至 {value}",
			usage: "订阅用量",
			usageRefresh: "刷新",
			usageRefreshing: "刷新中…",
			usageNotSignedIn: "登录后可查看 Cursor 返回的用量。",
			usageLoading: "正在读取用量…",
			usageError: "无法读取用量",
			usageUpdated: "更新于 {value}",
			plan: "套餐",
			unlimited: "不限额",
			includedRequests: "包含请求",
			requestsUsed: "已用 {used} / {limit} 次请求（{pct}%）",
			onDemandSpend: "按需消费",
			teamOnDemand: "团队按需",
			planUsage: "计划使用量",
			spendUsed: "已消费 ${used}",
			spendUsedOf: "已消费 ${used} / ${limit}",
			billingCycle: "账单周期",
			billingDaysLeft: "剩余 {value} 天",
			planPercent: "计划使用 {value}%",
			models: "模型列表",
			modelsRefresh: "刷新模型列表",
			modelsRefreshing: "刷新中…",
			modelsEmpty: "暂无模型数据",
			modelsCount: "{value} 个模型",
			modelsLoading: "正在读取模型列表…",
		};
		const en = {
			nav: "Cursor",
			title: "Cursor subscription",
			connected: "Signed in",
			disconnected: "Not signed in",
			accountLoading: "Reading account status…",
			login: "Browser sign-in",
			logout: "Sign out",
			cancel: "Cancel",
			openLogin: "Open sign-in page",
			waiting: "Waiting for sign-in to finish…",
			failed: "Sign-in failed. Try again.",
			loadFailed: "Could not read Cursor state.",
			note: "After signing in with a Cursor account in the browser, Cursor subscription models become available in the model picker. Credentials stay on this machine.",
			expiresAt: "Token valid until {value}",
			usage: "Subscription usage",
			usageRefresh: "Refresh",
			usageRefreshing: "Refreshing…",
			usageNotSignedIn: "Sign in to read usage reported by Cursor.",
			usageLoading: "Reading usage…",
			usageError: "Could not read usage",
			usageUpdated: "Updated {value}",
			plan: "Plan",
			unlimited: "Unlimited",
			includedRequests: "Included requests",
			requestsUsed: "{used} / {limit} requests used ({pct}%)",
			onDemandSpend: "On-demand spend",
			teamOnDemand: "Team on-demand",
			planUsage: "Plan usage",
			spendUsed: "${used} spent",
			spendUsedOf: "${used} / ${limit} spent",
			billingCycle: "Billing cycle",
			billingDaysLeft: "{value} days left",
			planPercent: "Plan used {value}%",
			models: "Models",
			modelsRefresh: "Refresh models",
			modelsRefreshing: "Refreshing…",
			modelsEmpty: "No model data yet",
			modelsCount: "{value} models",
			modelsLoading: "Reading model list…",
		};

		const STYLE = `
.cursorSubscription{display:flex;flex-direction:column;gap:10px;max-width:720px;color:var(--dsw-alias-label-primary);container-type:inline-size}
.cursorSubscription h2,.cursorSubscription h3,.cursorSubscription p{margin:0}
.cursorSubscriptionHead{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cursorSubscription h2{font-size:16px;line-height:24px;font-weight:500}
.cursorSubscription h3{font-size:14px;line-height:22px;font-weight:500}
.cursorSubscriptionCard{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:14px 16px;display:flex;flex-direction:column;gap:12px}
.cursorSubscriptionAccountRow{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cursorSubscriptionStatus{display:flex;align-items:center;gap:8px;font-size:14px;line-height:22px;font-weight:500}
.cursorSubscriptionDot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-dimmed)}
.cursorSubscriptionDot[data-state=connected]{background:var(--dsw-alias-state-success-primary)}
.cursorSubscriptionDot[data-state=disconnected]{background:var(--dsw-alias-state-error-primary)}
.cursorSubscriptionActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.cursorSubscriptionFlow{display:flex;flex-direction:column;gap:10px;padding:12px 14px;border-radius:10px;background:var(--dsw-alias-bg-module-platform)}
.cursorSubscriptionFlow p{font-size:13px;line-height:20px;color:var(--dsw-alias-label-secondary)}
.cursorSubscriptionError{font-size:13px;line-height:20px;color:var(--dsw-alias-state-error-primary)}
.cursorSubscriptionNote{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionFreshness{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionSectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cursorSubscriptionSectionTitle{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}
.cursorSubscriptionRefresh{flex:0 0 auto;min-width:72px;width:max-content;white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important;writing-mode:horizontal-tb!important}
.cursorSubscriptionRefresh *{white-space:nowrap!important;word-break:keep-all!important;writing-mode:horizontal-tb!important}
.cursorSubscriptionEmpty{padding:18px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionUsageRow{display:flex;flex-direction:column;gap:6px}
.cursorSubscriptionUsageTop{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.cursorSubscriptionUsageLabel{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.cursorSubscriptionUsageTop strong{font:600 16px/22px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}
.cursorSubscriptionUsage progress{width:100%;height:6px;border:0;border-radius:999px;overflow:hidden;background:var(--dsw-alias-border-l3);accent-color:var(--dsw-alias-brand-primary,#3964fe);-webkit-appearance:none;appearance:none}
.cursorSubscriptionUsage progress::-webkit-progress-bar{background:var(--dsw-alias-border-l3);border-radius:999px}
.cursorSubscriptionUsage progress::-webkit-progress-value{background:var(--dsw-alias-brand-primary,#3964fe);border-radius:999px}
.cursorSubscriptionUsage progress::-moz-progress-bar{background:var(--dsw-alias-brand-primary,#3964fe);border-radius:999px}
.cursorSubscriptionMetaRow{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionModels{display:flex;flex-direction:column;gap:8px}
.cursorSubscriptionModelChips{display:flex;flex-wrap:wrap;gap:6px}
.cursorSubscriptionModelChip{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);padding:3px 8px;font:500 12px/18px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
`;

		const unwrap = (response) => {
			if (!response?.ok) throw new Error(response?.error?.message ?? "Cursor RPC failed");
			return response.value;
		};
		const fill = (text, values) => Object.entries(values).reduce((next, [key, value]) => next.replace(`{${key}}`, String(value)), text);
		const validDate = (value) => {
			const date = new Date(value);
			return Number.isFinite(date.getTime()) ? date : undefined;
		};
		const percent = (value) => Number(value).toLocaleString(void 0, { maximumFractionDigits: 1 });
		const money = (value) => Number(value).toLocaleString(void 0, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

		function AccountCard({ rpc, t, account, setAccount, onSignedOut }) {
			const [flow, setFlow] = react.useState();
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState();
			const call = (endpoint, payload = {}) => rpc.call(CHANNEL, endpoint, payload).then(unwrap);
			react.useEffect(() => {
				if (flow?.id === undefined || ["authenticated", "failed", "cancelled"].includes(flow.phase)) return undefined;
				const timer = window.setInterval(() => {
					call("login/status", { id: flow.id })
						.then((next) => {
							setFlow(next);
							if (next.phase === "authenticated") {
								call("status").then(setAccount).catch(() => setError(t("failed")));
							}
						})
						.catch(() => setError(t("failed")));
				}, 1200);
				return () => window.clearInterval(timer);
			}, [flow?.id, flow?.phase]);
			const begin = () => {
				setBusy(true);
				setError(undefined);
				call("login/start", { openExternal: true })
					.then(setFlow)
					.catch(() => setError(t("failed")))
					.finally(() => setBusy(false));
			};
			const cancel = () => {
				if (flow?.id === undefined) return;
				setBusy(true);
				call("login/cancel", { id: flow.id })
					.then(setFlow)
					.finally(() => setBusy(false));
			};
			const logout = () => {
				setBusy(true);
				setError(undefined);
				call("logout")
					.then((next) => {
						setAccount(next);
						setFlow(undefined);
						onSignedOut();
					})
					.catch(() => setError(t("failed")))
					.finally(() => setBusy(false));
			};
			const signedIn = account?.authenticated === true;
			const accountReady = account !== undefined;
			const expiresAt = Number.isFinite(account?.expiresAt) ? new Date(account.expiresAt) : undefined;
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionCard",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionAccountRow",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "cursorSubscriptionStatus",
								role: "status",
								"aria-live": "polite",
								children: [
									react_jsx_runtime.jsx("span", {
										className: "cursorSubscriptionDot",
										"data-state": accountReady ? signedIn ? "connected" : "disconnected" : "loading",
										"aria-hidden": "true",
									}),
									accountReady ? signedIn ? t("connected") : t("disconnected") : t("accountLoading"),
								],
							}),
							react_jsx_runtime.jsx("div", {
								className: "cursorSubscriptionActions",
								children: signedIn
									? react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
											type: "button",
											variant: "outline",
											disabled: busy,
											onClick: logout,
											children: t("logout"),
										})
									: accountReady && (flow === undefined || ["failed", "cancelled"].includes(flow.phase))
										? react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
												type: "button",
												variant: "primary",
												disabled: busy,
												onClick: begin,
												children: t("login"),
											})
										: null,
							}),
						],
					}),
					signedIn && expiresAt !== undefined
						? react_jsx_runtime.jsx("time", {
								className: "cursorSubscriptionFreshness",
								dateTime: expiresAt.toISOString(),
								children: fill(t("expiresAt"), { value: expiresAt.toLocaleString() }),
							})
						: null,
					!signedIn && flow !== undefined && ["starting", "waiting_browser", "waiting_input"].includes(flow.phase)
						? react_jsx_runtime.jsxs("div", {
								className: "cursorSubscriptionFlow",
								children: [
									react_jsx_runtime.jsx("p", { children: t("waiting") }),
									flow.authUrl === undefined
										? null
										: react_jsx_runtime.jsx("a", { href: flow.authUrl, target: "_blank", rel: "noreferrer", children: t("openLogin") }),
									react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
										type: "button",
										variant: "outline",
										disabled: busy,
										onClick: cancel,
										children: t("cancel"),
									}),
								],
							})
						: null,
					flow?.phase === "failed" || error !== undefined
						? react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", role: "alert", children: error ?? t("failed") }),
									flow?.detail
										? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", children: flow.detail })
										: null,
								],
							})
						: null,
				],
			});
		}

		function UsageRow({ label, used, limit, meta, showRemaining = true }) {
			const remaining = Math.max(0, limit - used);
			const usedPct = limit > 0 ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionUsageRow",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionUsageTop",
						children: [
							react_jsx_runtime.jsx("span", { className: "cursorSubscriptionUsageLabel", children: label }),
							react_jsx_runtime.jsx("strong", {
								children: showRemaining ? `${percent(remaining)}% 剩余` : `${percent(usedPct)}%`,
							}),
						],
					}),
					react_jsx_runtime.jsx("progress", {
						max: "100",
						value: usedPct,
						"aria-label": `${label} ${percent(usedPct)}%`,
					}),
					react_jsx_runtime.jsx("div", {
						className: "cursorSubscriptionMetaRow",
						children: [react_jsx_runtime.jsx("span", { children: meta })],
					}),
				],
			});
		}

		function UsageCard({ rpc, t, signedIn, resetKey }) {
			const [usage, setUsage] = react.useState();
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState();
			const request = react.useRef(0);
			const load = (force) => {
				if (!signedIn) return;
				const id = ++request.current;
				setBusy(true);
				setError(undefined);
				rpc.call(CHANNEL, "usage", { force })
					.then(unwrap)
					.then((next) => {
						if (request.current === id) setUsage(next);
					})
					.catch((err) => {
						if (request.current === id) setError(err.message);
					})
					.finally(() => {
						if (request.current === id) setBusy(false);
					});
			};
			react.useEffect(() => {
				if (signedIn) load(false);
				else {
					request.current += 1;
					setUsage(undefined);
					setError(undefined);
					setBusy(false);
				}
				return () => {
					request.current += 1;
				};
			}, [signedIn, resetKey]);
			const fetchedAt = typeof usage?.fetchedAt === "number" ? validDate(usage.fetchedAt) : undefined;
			const ir = usage?.includedRequests;
			const spend = usage?.individualOnDemand;
			const teamSpend = usage?.teamOnDemand;
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionCard",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionSectionHead",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "cursorSubscriptionSectionTitle",
								children: [
									react_jsx_runtime.jsx("h3", { children: t("usage") }),
									fetchedAt === undefined
										? null
										: react_jsx_runtime.jsx("time", {
												className: "cursorSubscriptionFreshness",
												dateTime: fetchedAt.toISOString(),
												children: fill(t("usageUpdated"), { value: fetchedAt.toLocaleString() }),
											}),
								],
							}),
							react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: "cursorSubscriptionRefresh",
								type: "button",
								variant: "outline",
								disabled: !signedIn || busy,
								"aria-busy": busy,
								onClick: () => load(true),
								children: busy ? t("usageRefreshing") : t("usageRefresh"),
							}),
						],
					}),
					react_jsx_runtime.jsxs("div", {
						"aria-live": "polite",
						children: [
							!signedIn
								? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionEmpty", children: t("usageNotSignedIn") })
								: null,
							signedIn && busy && usage === undefined
								? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionEmpty", role: "status", children: t("usageLoading") })
								: null,
						],
					}),
					error === undefined
						? null
						: react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", role: "alert", children: error }),
					usage === undefined || !signedIn
						? null
						: react_jsx_runtime.jsxs(react_jsx_runtime.Fragment, {
								children: [
									usage.isUnlimited === true
										? react_jsx_runtime.jsxs("div", {
												className: "cursorSubscriptionUsageRow",
												children: [
													react_jsx_runtime.jsxs("div", {
														className: "cursorSubscriptionUsageTop",
														children: [
															react_jsx_runtime.jsx("span", { className: "cursorSubscriptionUsageLabel", children: t("plan") }),
															react_jsx_runtime.jsx("strong", { children: t("unlimited") }),
														],
													}),
												],
											})
										: null,
									ir !== undefined && usage.isUnlimited !== true
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("includedRequests"),
												used: ir.used,
												limit: ir.limit,
												meta: fill(t("requestsUsed"), { used: ir.used, limit: ir.limit, pct: percent(ir.pct) }),
											})
										: null,
									usage?.plan?.autoPercentUsed !== undefined
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("planUsage"),
												used: usage.plan.autoPercentUsed,
												limit: 100,
												showRemaining: false,
												meta: fill(t("planPercent"), { value: percent(usage.plan.autoPercentUsed) }),
											})
										: null,
									spend !== undefined
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("onDemandSpend"),
												used: spend.usedDollars,
												limit: spend.limitDollars ?? Math.max(spend.usedDollars, 1),
												meta:
													spend.limitDollars === undefined
														? fill(t("spendUsed"), { used: money(spend.usedDollars) })
														: fill(t("spendUsedOf"), { used: money(spend.usedDollars), limit: money(spend.limitDollars) }),
											})
										: null,
									teamSpend !== undefined && teamSpend.limitDollars !== undefined
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("teamOnDemand"),
												used: teamSpend.usedDollars,
												limit: teamSpend.limitDollars,
												meta: fill(t("spendUsedOf"), { used: money(teamSpend.usedDollars), limit: money(teamSpend.limitDollars) }),
											})
										: null,
									usage?.billingCycle !== undefined
										? react_jsx_runtime.jsx("div", {
												className: "cursorSubscriptionMetaRow",
												children: [
													react_jsx_runtime.jsx("span", { children: `${t("billingCycle")}: ${new Date(usage.billingCycle.start).toLocaleDateString()} – ${new Date(usage.billingCycle.end).toLocaleDateString()}` }),
													usage.billingCycle.daysLeft !== undefined
														? react_jsx_runtime.jsx("span", { children: fill(t("billingDaysLeft"), { value: usage.billingCycle.daysLeft }) })
														: null,
												],
											})
										: null,
								],
							}),
				],
			});
		}

		function ModelsCard({ rpc, t, signedIn }) {
			const [data, setData] = react.useState();
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState();
			const request = react.useRef(0);
			const load = (force) => {
				if (!signedIn) return;
				const id = ++request.current;
				setBusy(true);
				setError(undefined);
				rpc.call(CHANNEL, "models", { force })
					.then(unwrap)
					.then((next) => {
						if (request.current === id) setData(next);
					})
					.catch((err) => {
						if (request.current === id) setError(err.message);
					})
					.finally(() => {
						if (request.current === id) setBusy(false);
					});
			};
			react.useEffect(() => {
				if (signedIn) load(false);
				else {
					request.current += 1;
					setData(undefined);
					setError(undefined);
					setBusy(false);
				}
				return () => {
					request.current += 1;
				};
			}, [signedIn]);
			const models = Array.isArray(data?.models) ? data.models : [];
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionCard",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionSectionHead",
						children: [
							react_jsx_runtime.jsxs("div", {
								className: "cursorSubscriptionSectionTitle",
								children: [
									react_jsx_runtime.jsx("h3", { children: t("models") }),
									models.length > 0
										? react_jsx_runtime.jsx("span", { className: "cursorSubscriptionFreshness", children: fill(t("modelsCount"), { value: models.length }) })
										: null,
								],
							}),
							react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
								className: "cursorSubscriptionRefresh",
								type: "button",
								variant: "outline",
								disabled: !signedIn || busy,
								"aria-busy": busy,
								onClick: () => load(true),
								children: busy ? t("modelsRefreshing") : t("modelsRefresh"),
							}),
						],
					}),
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionModels",
						"aria-live": "polite",
						children: [
							!signedIn
								? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionEmpty", children: t("usageNotSignedIn") })
								: null,
							signedIn && busy && models.length === 0
								? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionEmpty", role: "status", children: t("modelsLoading") })
								: null,
							error === undefined
								? null
								: react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", role: "alert", children: error }),
							models.length > 0
								? react_jsx_runtime.jsx("div", {
										className: "cursorSubscriptionModelChips",
										children: models.map((model) =>
											react_jsx_runtime.jsx("span", { className: "cursorSubscriptionModelChip", title: model.name, children: model.id }),
										),
									})
								: null,
						],
					}),
				],
			});
		}

		function CursorSection({ rpc, t }) {
			const [account, setAccount] = react.useState();
			const [error, setError] = react.useState();
			const [resetKey, setResetKey] = react.useState(0);
			react.useEffect(() => {
				let live = true;
				rpc.call(CHANNEL, "status", {})
					.then(unwrap)
					.then((next) => {
						if (live) setAccount(next);
					})
					.catch(() => {
						if (live) setError(t("loadFailed"));
					});
				return () => {
					live = false;
				};
			}, [resetKey]);
			const signedIn = account?.authenticated === true;
			return react_jsx_runtime.jsxs("section", {
				className: "cursorSubscription",
				children: [
					react_jsx_runtime.jsx("div", {
						className: "cursorSubscriptionHead",
						children: react_jsx_runtime.jsx("h2", { children: t("title") }),
					}),
					error === undefined
						? null
						: react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", role: "alert", children: error }),
					react_jsx_runtime.jsx(AccountCard, {
						rpc,
						t,
						account,
						setAccount,
						onSignedOut: () => setResetKey((value) => value + 1),
					}),
					react_jsx_runtime.jsx(UsageCard, { rpc, t, signedIn, resetKey }),
					react_jsx_runtime.jsx(ModelsCard, { rpc, t, signedIn }),
					react_jsx_runtime.jsx("p", { className: "cursorSubscriptionNote", children: t("note") }),
				],
			});
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "cursor-subscription: copy");
			ctx.effect(() => {
				const tag = document.createElement("style");
				tag.dataset.plugin = "dsh-cursor-subscription";
				tag.textContent = STYLE;
				document.head.append(tag);
				return () => tag.remove();
			}, "cursor-subscription: style");
			const connection = ctx.get("connection");
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "cursor-subscription",
						order: 20,
						label: () => t("nav"),
						locale: NS,
						inject: () => ({ rpc: connection.rpc, t }),
					},
					CursorSection,
				),
			);
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
