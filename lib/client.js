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
			usageUpdated: "更新于 {value}",
			plan: "套餐",
			unlimited: "不限额",
			includedRequests: "包含请求",
			requestsUsed: "已用 {used} / {limit} 次请求（{pct}%）",
			onDemandSpend: "按需消费",
			autoUsage: "计划 Cursor 模型使用量",
			otherModels: "计划其他模型使用量",
			modelUsage: "模型用量",
			spendUsedOf: "已消费 ${used} / ${limit}",
			billingCycle: "账单周期",
			billingDaysLeft: "剩余 {value} 天",
			autoPercent: "计划 Cursor 模型 {value}%",
			otherModelsPercent: "计划其他模型 {value}%",
			otherModelsUnknown: "尚未读到该用量",
			modelSpendPct: "{model} 已用 ${used}（{pct}%）",
			models: "模型列表",
			modelsRefresh: "刷新模型列表",
			modelsRefreshing: "刷新中…",
			modelsCount: "{value} 个模型",
			modelsLoading: "正在读取模型列表…",
			runtimeSettings: "运行设置",
			runtimeSettingsNote: "设置会保存到当前 DSH profile，并从下一次 Cursor 请求开始生效。",
			maxToolRounds: "最大工具轮次",
			maxToolRoundsHint: "单次 Cursor 任务允许的工具轮次，超过后以 TOOL_LIMIT 终止。范围 1–1000。",
			retryCount: "重试次数",
			retryCountHint: "匹配状态码时允许的额外请求次数。默认 0（关闭），启用后可能重复 Cursor 远端模型请求或用量。范围 0–10。",
			retryInterval: "重试间隔（毫秒）",
			retryIntervalHint: "每次 HTTP 重试前等待的固定时间。范围 0–300000。",
			retryStatuses: "重试 HTTP 状态码",
			retryStatusesHint: "使用逗号分隔，例如 408, 425, 429, 500, 502, 503, 504。",
			saveSettings: "保存设置",
			savingSettings: "保存中…",
			reloadSettings: "重新加载",
			loadingSettings: "加载中…",
			settingsSaved: "设置已保存。",
			settingsLoadFailed: "无法读取运行设置。",
			settingsSaveFailed: "无法保存运行设置。",
			settingsInvalid: "请检查工具轮次、重试次数、间隔和 HTTP 状态码。",
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
			usageUpdated: "Updated {value}",
			plan: "Plan",
			unlimited: "Unlimited",
			includedRequests: "Included requests",
			requestsUsed: "{used} / {limit} requests used ({pct}%)",
			onDemandSpend: "On-demand spend",
			autoUsage: "Plan Cursor model usage",
			otherModels: "Plan other model usage",
			modelUsage: "Model usage",
			spendUsedOf: "${used} / ${limit} spent",
			billingCycle: "Billing cycle",
			billingDaysLeft: "{value} days left",
			autoPercent: "Plan Cursor models {value}%",
			otherModelsPercent: "Plan other models {value}%",
			otherModelsUnknown: "This usage value has not been read yet",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "Models",
			modelsRefresh: "Refresh models",
			modelsRefreshing: "Refreshing…",
			modelsCount: "{value} models",
			modelsLoading: "Reading model list…",
			runtimeSettings: "Runtime settings",
			runtimeSettingsNote: "Settings are stored in the current DSH profile and apply from the next Cursor request.",
			maxToolRounds: "Maximum tool rounds",
			maxToolRoundsHint: "Tool rounds allowed in one Cursor task before TOOL_LIMIT stops it. Range: 1–1000.",
			retryCount: "Retry count",
			retryCountHint: "Additional attempts for matching statuses. Default: 0 (off). Enabling retries may repeat remote Cursor model work or usage. Range: 0–10.",
			retryInterval: "Retry interval (ms)",
			retryIntervalHint: "Fixed delay before each HTTP retry. Range: 0–300000.",
			retryStatuses: "Retry HTTP status codes",
			retryStatusesHint: "Comma-separated, for example: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Save settings",
			savingSettings: "Saving…",
			reloadSettings: "Reload",
			loadingSettings: "Loading…",
			settingsSaved: "Settings saved.",
			settingsLoadFailed: "Could not read runtime settings.",
			settingsSaveFailed: "Could not save runtime settings.",
			settingsInvalid: "Check the tool rounds, retry count, interval, and HTTP status codes.",
		};
		const zhHant = {
			nav: "Cursor 訂閱",
			title: "Cursor 訂閱",
			connected: "已登入",
			disconnected: "未登入",
			accountLoading: "正在讀取帳戶狀態…",
			login: "瀏覽器登入",
			logout: "登出",
			cancel: "取消",
			openLogin: "開啟登入頁",
			waiting: "正在等待登入完成…",
			failed: "登入失敗，請重試。",
			loadFailed: "無法讀取 Cursor 狀態。",
			note: "在瀏覽器登入 Cursor 帳戶後，即可在模型選擇器中使用 Cursor 訂閱模型。登入資訊僅保存在本機，不會上傳。",
			expiresAt: "權杖有效至 {value}",
			usage: "訂閱用量",
			usageRefresh: "重新整理",
			usageRefreshing: "重新整理中…",
			usageNotSignedIn: "登入後可查看 Cursor 回報的用量。",
			usageLoading: "正在讀取用量…",
			usageUpdated: "更新於 {value}",
			plan: "方案",
			unlimited: "不限額",
			includedRequests: "包含請求",
			requestsUsed: "已用 {used} / {limit} 次請求（{pct}%）",
			onDemandSpend: "隨用隨付支出",
			autoUsage: "方案 Cursor 模型用量",
			otherModels: "方案其他模型用量",
			modelUsage: "模型用量",
			spendUsedOf: "已消費 ${used} / ${limit}",
			billingCycle: "帳單週期",
			billingDaysLeft: "剩餘 {value} 天",
			autoPercent: "方案 Cursor 模型 {value}%",
			otherModelsPercent: "方案其他模型 {value}%",
			otherModelsUnknown: "尚未讀取到該用量",
			modelSpendPct: "{model} 已用 ${used}（{pct}%）",
			models: "模型清單",
			modelsRefresh: "重新整理模型清單",
			modelsRefreshing: "重新整理中…",
			modelsCount: "{value} 個模型",
			modelsLoading: "正在讀取模型清單…",
			runtimeSettings: "執行設定",
			runtimeSettingsNote: "設定會儲存到目前的 DSH profile，並從下一次 Cursor 請求開始生效。",
			maxToolRounds: "最大工具輪次",
			maxToolRoundsHint: "單次 Cursor 任務允許的工具輪次，超過後以 TOOL_LIMIT 終止。範圍 1–1000。",
			retryCount: "重試次數",
			retryCountHint: "符合狀態碼時允許的額外請求次數。預設 0（關閉），啟用後可能重複 Cursor 遠端模型請求或用量。範圍 0–10。",
			retryInterval: "重試間隔（毫秒）",
			retryIntervalHint: "每次 HTTP 重試前等待的固定時間。範圍 0–300000。",
			retryStatuses: "重試 HTTP 狀態碼",
			retryStatusesHint: "以逗號分隔，例如 408, 425, 429, 500, 502, 503, 504。",
			saveSettings: "儲存設定",
			savingSettings: "儲存中…",
			reloadSettings: "重新載入",
			loadingSettings: "載入中…",
			settingsSaved: "設定已儲存。",
			settingsLoadFailed: "無法讀取執行設定。",
			settingsSaveFailed: "無法儲存執行設定。",
			settingsInvalid: "請檢查工具輪次、重試次數、間隔和 HTTP 狀態碼。",
		};
		const ja = {
			nav: "Cursor",
			title: "Cursor サブスクリプション",
			connected: "サインイン済み",
			disconnected: "未サインイン",
			accountLoading: "アカウント状態を読み込み中…",
			login: "ブラウザーでサインイン",
			logout: "サインアウト",
			cancel: "キャンセル",
			openLogin: "サインインページを開く",
			waiting: "サインインの完了を待っています…",
			failed: "サインインに失敗しました。もう一度お試しください。",
			loadFailed: "Cursor の状態を読み取れませんでした。",
			note: "ブラウザーで Cursor アカウントにサインインすると、モデル選択で Cursor サブスクリプションのモデルを利用できます。認証情報はこのマシン内にのみ保存されます。",
			expiresAt: "トークン有効期限 {value}",
			usage: "サブスクリプション使用量",
			usageRefresh: "更新",
			usageRefreshing: "更新中…",
			usageNotSignedIn: "サインインすると Cursor が報告する使用量を確認できます。",
			usageLoading: "使用量を読み込み中…",
			usageUpdated: "{value} に更新",
			plan: "プラン",
			unlimited: "無制限",
			includedRequests: "含まれるリクエスト",
			requestsUsed: "{used} / {limit} リクエスト使用（{pct}%）",
			onDemandSpend: "オンデマンド利用額",
			autoUsage: "プランの Cursor モデル使用量",
			otherModels: "プランのその他モデル使用量",
			modelUsage: "モデル使用量",
			spendUsedOf: "${used} / ${limit} 使用",
			billingCycle: "請求サイクル",
			billingDaysLeft: "残り {value} 日",
			autoPercent: "プランの Cursor モデル {value}%",
			otherModelsPercent: "プランのその他モデル {value}%",
			otherModelsUnknown: "この使用量はまだ取得していません",
			modelSpendPct: "{model} ${used}（{pct}%）",
			models: "モデル",
			modelsRefresh: "モデルを更新",
			modelsRefreshing: "更新中…",
			modelsCount: "{value} 個のモデル",
			modelsLoading: "モデル一覧を読み込み中…",
			runtimeSettings: "実行設定",
			runtimeSettingsNote: "設定は現在の DSH profile に保存され、次回の Cursor リクエストから適用されます。",
			maxToolRounds: "最大ツールラウンド",
			maxToolRoundsHint: "1 回の Cursor タスクで許可されるツールラウンド数。超えると TOOL_LIMIT で終了します。範囲: 1〜1000。",
			retryCount: "リトライ回数",
			retryCountHint: "該当するステータスに対する追加リクエスト回数。既定 0（無効）。有効にすると Cursor のリモートモデル処理や使用量が重複する場合があります。範囲: 0〜10。",
			retryInterval: "リトライ間隔（ミリ秒）",
			retryIntervalHint: "各 HTTP リトライ前の固定待機時間。範囲: 0〜300000。",
			retryStatuses: "リトライする HTTP ステータスコード",
			retryStatusesHint: "カンマ区切り、例: 408, 425, 429, 500, 502, 503, 504。",
			saveSettings: "設定を保存",
			savingSettings: "保存中…",
			reloadSettings: "再読み込み",
			loadingSettings: "読み込み中…",
			settingsSaved: "設定を保存しました。",
			settingsLoadFailed: "実行設定を読み取れませんでした。",
			settingsSaveFailed: "実行設定を保存できませんでした。",
			settingsInvalid: "ツールラウンド、リトライ回数、間隔、HTTP ステータスコードを確認してください。",
		};
		const ko = {
			nav: "Cursor",
			title: "Cursor 구독",
			connected: "로그인됨",
			disconnected: "로그인하지 않음",
			accountLoading: "계정 상태를 불러오는 중…",
			login: "브라우저로 로그인",
			logout: "로그아웃",
			cancel: "취소",
			openLogin: "로그인 페이지 열기",
			waiting: "로그인 완료를 기다리는 중…",
			failed: "로그인에 실패했습니다. 다시 시도하세요.",
			loadFailed: "Cursor 상태를 읽을 수 없습니다.",
			note: "브라우저에서 Cursor 계정으로 로그인하면 모델 선택기에서 Cursor 구독 모델을 사용할 수 있습니다. 자격 증명은 이 컴퓨터에만 저장됩니다.",
			expiresAt: "토큰 만료 {value}",
			usage: "구독 사용량",
			usageRefresh: "새로 고침",
			usageRefreshing: "새로 고치는 중…",
			usageNotSignedIn: "로그인하면 Cursor가 보고하는 사용량을 볼 수 있습니다.",
			usageLoading: "사용량을 불러오는 중…",
			usageUpdated: "{value}에 업데이트",
			plan: "플랜",
			unlimited: "무제한",
			includedRequests: "포함된 요청",
			requestsUsed: "요청 {used} / {limit} 사용 ({pct}%)",
			onDemandSpend: "종량제 지출",
			autoUsage: "플랜 Cursor 모델 사용량",
			otherModels: "플랜 기타 모델 사용량",
			modelUsage: "모델 사용량",
			spendUsedOf: "${used} / ${limit} 사용",
			billingCycle: "결제 주기",
			billingDaysLeft: "{value}일 남음",
			autoPercent: "플랜 Cursor 모델 {value}%",
			otherModelsPercent: "플랜 기타 모델 {value}%",
			otherModelsUnknown: "이 사용량은 아직 읽지 않았습니다",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "모델",
			modelsRefresh: "모델 새로 고침",
			modelsRefreshing: "새로 고치는 중…",
			modelsCount: "모델 {value}개",
			modelsLoading: "모델 목록을 불러오는 중…",
			runtimeSettings: "실행 설정",
			runtimeSettingsNote: "설정은 현재 DSH profile에 저장되며 다음 Cursor 요청부터 적용됩니다.",
			maxToolRounds: "최대 도구 라운드",
			maxToolRoundsHint: "Cursor 작업 하나에서 허용되는 도구 라운드 수이며 초과하면 TOOL_LIMIT으로 종료됩니다. 범위: 1–1000.",
			retryCount: "재시도 횟수",
			retryCountHint: "일치하는 상태 코드에 대한 추가 요청 횟수. 기본값 0(해제). 사용하면 Cursor 원격 모델 작업이나 사용량이 중복될 수 있습니다. 범위: 0–10.",
			retryInterval: "재시도 간격(ms)",
			retryIntervalHint: "각 HTTP 재시도 전에 기다리는 고정 시간. 범위: 0–300000.",
			retryStatuses: "재시도할 HTTP 상태 코드",
			retryStatusesHint: "쉼표로 구분합니다. 예: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "설정 저장",
			savingSettings: "저장 중…",
			reloadSettings: "다시 불러오기",
			loadingSettings: "불러오는 중…",
			settingsSaved: "설정을 저장했습니다.",
			settingsLoadFailed: "실행 설정을 읽을 수 없습니다.",
			settingsSaveFailed: "실행 설정을 저장할 수 없습니다.",
			settingsInvalid: "도구 라운드, 재시도 횟수, 간격, HTTP 상태 코드를 확인하세요.",
		};
		const es = {
			nav: "Cursor",
			title: "Suscripción a Cursor",
			connected: "Sesión iniciada",
			disconnected: "Sin sesión",
			accountLoading: "Leyendo el estado de la cuenta…",
			login: "Iniciar sesión en el navegador",
			logout: "Cerrar sesión",
			cancel: "Cancelar",
			openLogin: "Abrir la página de inicio de sesión",
			waiting: "Esperando a que termine el inicio de sesión…",
			failed: "No se pudo iniciar sesión. Inténtalo de nuevo.",
			loadFailed: "No se pudo leer el estado de Cursor.",
			note: "Después de iniciar sesión con una cuenta de Cursor en el navegador, los modelos de la suscripción a Cursor estarán disponibles en el selector de modelos. Las credenciales permanecen en este equipo.",
			expiresAt: "Token válido hasta {value}",
			usage: "Uso de la suscripción",
			usageRefresh: "Actualizar",
			usageRefreshing: "Actualizando…",
			usageNotSignedIn: "Inicia sesión para ver el uso que informa Cursor.",
			usageLoading: "Leyendo el uso…",
			usageUpdated: "Actualizado {value}",
			plan: "Plan",
			unlimited: "Ilimitado",
			includedRequests: "Solicitudes incluidas",
			requestsUsed: "{used} / {limit} solicitudes usadas ({pct}%)",
			onDemandSpend: "Gasto bajo demanda",
			autoUsage: "Uso de modelos Cursor del plan",
			otherModels: "Uso de otros modelos del plan",
			modelUsage: "Uso por modelo",
			spendUsedOf: "${used} / ${limit} gastados",
			billingCycle: "Ciclo de facturación",
			billingDaysLeft: "Quedan {value} días",
			autoPercent: "Modelos Cursor del plan {value}%",
			otherModelsPercent: "Otros modelos del plan {value}%",
			otherModelsUnknown: "Este valor de uso aún no se ha leído",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "Modelos",
			modelsRefresh: "Actualizar modelos",
			modelsRefreshing: "Actualizando…",
			modelsCount: "{value} modelos",
			modelsLoading: "Leyendo la lista de modelos…",
			runtimeSettings: "Ajustes de ejecución",
			runtimeSettingsNote: "Los ajustes se guardan en el profile de DSH actual y se aplican desde la siguiente solicitud a Cursor.",
			maxToolRounds: "Rondas de herramientas máximas",
			maxToolRoundsHint: "Rondas de herramientas permitidas en una tarea de Cursor antes de que TOOL_LIMIT la detenga. Rango: 1–1000.",
			retryCount: "Número de reintentos",
			retryCountHint: "Intentos adicionales para los estados coincidentes. Predeterminado: 0 (desactivado). Activar los reintentos puede repetir trabajo o uso del modelo remoto de Cursor. Rango: 0–10.",
			retryInterval: "Intervalo de reintento (ms)",
			retryIntervalHint: "Espera fija antes de cada reintento HTTP. Rango: 0–300000.",
			retryStatuses: "Códigos de estado HTTP con reintento",
			retryStatusesHint: "Separados por comas, por ejemplo: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Guardar ajustes",
			savingSettings: "Guardando…",
			reloadSettings: "Recargar",
			loadingSettings: "Cargando…",
			settingsSaved: "Ajustes guardados.",
			settingsLoadFailed: "No se pudieron leer los ajustes de ejecución.",
			settingsSaveFailed: "No se pudieron guardar los ajustes de ejecución.",
			settingsInvalid: "Comprueba las rondas de herramientas, los reintentos, el intervalo y los códigos de estado HTTP.",
		};
		const fr = {
			nav: "Cursor",
			title: "Abonnement Cursor",
			connected: "Connecté",
			disconnected: "Non connecté",
			accountLoading: "Lecture de l'état du compte…",
			login: "Se connecter via le navigateur",
			logout: "Se déconnecter",
			cancel: "Annuler",
			openLogin: "Ouvrir la page de connexion",
			waiting: "En attente de la fin de la connexion…",
			failed: "Échec de la connexion. Réessayez.",
			loadFailed: "Impossible de lire l'état de Cursor.",
			note: "Après vous être connecté à un compte Cursor dans le navigateur, les modèles de l'abonnement Cursor apparaissent dans le sélecteur de modèles. Les identifiants restent sur cette machine.",
			expiresAt: "Jeton valide jusqu'au {value}",
			usage: "Utilisation de l'abonnement",
			usageRefresh: "Actualiser",
			usageRefreshing: "Actualisation…",
			usageNotSignedIn: "Connectez-vous pour consulter l'utilisation signalée par Cursor.",
			usageLoading: "Lecture de l'utilisation…",
			usageUpdated: "Mis à jour {value}",
			plan: "Forfait",
			unlimited: "Illimité",
			includedRequests: "Requêtes incluses",
			requestsUsed: "{used} / {limit} requêtes utilisées ({pct} %)",
			onDemandSpend: "Dépenses à la demande",
			autoUsage: "Utilisation des modèles Cursor du forfait",
			otherModels: "Utilisation des autres modèles du forfait",
			modelUsage: "Utilisation par modèle",
			spendUsedOf: "${used} / ${limit} dépensés",
			billingCycle: "Cycle de facturation",
			billingDaysLeft: "{value} jours restants",
			autoPercent: "Modèles Cursor du forfait {value} %",
			otherModelsPercent: "Autres modèles du forfait {value} %",
			otherModelsUnknown: "Cette valeur d'utilisation n'a pas encore été lue",
			modelSpendPct: "{model} ${used} ({pct} %)",
			models: "Modèles",
			modelsRefresh: "Actualiser les modèles",
			modelsRefreshing: "Actualisation…",
			modelsCount: "{value} modèles",
			modelsLoading: "Lecture de la liste des modèles…",
			runtimeSettings: "Paramètres d'exécution",
			runtimeSettingsNote: "Les paramètres sont enregistrés dans le profile DSH actuel et s'appliquent à partir de la prochaine requête Cursor.",
			maxToolRounds: "Nombre maximal de tours d'outils",
			maxToolRoundsHint: "Tours d'outils autorisés dans une tâche Cursor avant l'arrêt par TOOL_LIMIT. Plage : 1–1000.",
			retryCount: "Nombre de tentatives",
			retryCountHint: "Tentatives supplémentaires pour les statuts correspondants. Par défaut : 0 (désactivé). Activer les tentatives peut répéter le travail ou l'utilisation du modèle Cursor distant. Plage : 0–10.",
			retryInterval: "Intervalle de nouvelle tentative (ms)",
			retryIntervalHint: "Délai fixe avant chaque nouvelle tentative HTTP. Plage : 0–300000.",
			retryStatuses: "Codes d'état HTTP à réessayer",
			retryStatusesHint: "Séparés par des virgules, par exemple : 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Enregistrer les paramètres",
			savingSettings: "Enregistrement…",
			reloadSettings: "Recharger",
			loadingSettings: "Chargement…",
			settingsSaved: "Paramètres enregistrés.",
			settingsLoadFailed: "Impossible de lire les paramètres d'exécution.",
			settingsSaveFailed: "Impossible d'enregistrer les paramètres d'exécution.",
			settingsInvalid: "Vérifiez les tours d'outils, le nombre de tentatives, l'intervalle et les codes d'état HTTP.",
		};
		const de = {
			nav: "Cursor",
			title: "Cursor-Abonnement",
			connected: "Angemeldet",
			disconnected: "Nicht angemeldet",
			accountLoading: "Kontostatus wird gelesen…",
			login: "Im Browser anmelden",
			logout: "Abmelden",
			cancel: "Abbrechen",
			openLogin: "Anmeldeseite öffnen",
			waiting: "Warten auf den Abschluss der Anmeldung…",
			failed: "Anmeldung fehlgeschlagen. Bitte erneut versuchen.",
			loadFailed: "Cursor-Status konnte nicht gelesen werden.",
			note: "Nach der Anmeldung mit einem Cursor-Konto im Browser stehen die Modelle des Cursor-Abonnements in der Modellauswahl bereit. Die Anmeldedaten bleiben auf diesem Rechner.",
			expiresAt: "Token gültig bis {value}",
			usage: "Abonnement-Nutzung",
			usageRefresh: "Aktualisieren",
			usageRefreshing: "Wird aktualisiert…",
			usageNotSignedIn: "Melden Sie sich an, um die von Cursor gemeldete Nutzung zu sehen.",
			usageLoading: "Nutzung wird gelesen…",
			usageUpdated: "Aktualisiert {value}",
			plan: "Tarif",
			unlimited: "Unbegrenzt",
			includedRequests: "Enthaltene Anfragen",
			requestsUsed: "{used} / {limit} Anfragen verwendet ({pct} %)",
			onDemandSpend: "Nutzungsabhängige Ausgaben",
			autoUsage: "Cursor-Modellnutzung des Tarifs",
			otherModels: "Nutzung anderer Modelle des Tarifs",
			modelUsage: "Nutzung je Modell",
			spendUsedOf: "${used} / ${limit} ausgegeben",
			billingCycle: "Abrechnungszeitraum",
			billingDaysLeft: "Noch {value} Tage",
			autoPercent: "Cursor-Modelle des Tarifs {value} %",
			otherModelsPercent: "Andere Modelle des Tarifs {value} %",
			otherModelsUnknown: "Dieser Nutzungswert wurde noch nicht gelesen",
			modelSpendPct: "{model} ${used} ({pct} %)",
			models: "Modelle",
			modelsRefresh: "Modelle aktualisieren",
			modelsRefreshing: "Wird aktualisiert…",
			modelsCount: "{value} Modelle",
			modelsLoading: "Modellliste wird gelesen…",
			runtimeSettings: "Laufzeiteinstellungen",
			runtimeSettingsNote: "Einstellungen werden im aktuellen DSH-profile gespeichert und gelten ab der nächsten Cursor-Anfrage.",
			maxToolRounds: "Maximale Tool-Runden",
			maxToolRoundsHint: "Erlaubte Tool-Runden in einer Cursor-Aufgabe, bevor TOOL_LIMIT abbricht. Bereich: 1–1000.",
			retryCount: "Anzahl der Wiederholungen",
			retryCountHint: "Zusätzliche Versuche bei passenden Statuscodes. Standard: 0 (aus). Aktivierte Wiederholungen können Remote-Arbeit oder Nutzung des Cursor-Modells duplizieren. Bereich: 0–10.",
			retryInterval: "Wiederholungsintervall (ms)",
			retryIntervalHint: "Feste Wartezeit vor jedem HTTP-Wiederholungsversuch. Bereich: 0–300000.",
			retryStatuses: "HTTP-Statuscodes für Wiederholung",
			retryStatusesHint: "Kommagetrennt, zum Beispiel: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Einstellungen speichern",
			savingSettings: "Wird gespeichert…",
			reloadSettings: "Neu laden",
			loadingSettings: "Wird geladen…",
			settingsSaved: "Einstellungen gespeichert.",
			settingsLoadFailed: "Laufzeiteinstellungen konnten nicht gelesen werden.",
			settingsSaveFailed: "Laufzeiteinstellungen konnten nicht gespeichert werden.",
			settingsInvalid: "Prüfen Sie Tool-Runden, Anzahl der Wiederholungen, Intervall und HTTP-Statuscodes.",
		};
		const ru = {
			nav: "Cursor",
			title: "Подписка Cursor",
			connected: "Вход выполнен",
			disconnected: "Вход не выполнен",
			accountLoading: "Чтение состояния аккаунта…",
			login: "Войти через браузер",
			logout: "Выйти",
			cancel: "Отмена",
			openLogin: "Открыть страницу входа",
			waiting: "Ожидание завершения входа…",
			failed: "Не удалось войти. Повторите попытку.",
			loadFailed: "Не удалось прочитать состояние Cursor.",
			note: "После входа в аккаунт Cursor в браузере модели подписки Cursor появятся в выборе моделей. Учётные данные остаются на этом компьютере.",
			expiresAt: "Токен действителен до {value}",
			usage: "Использование подписки",
			usageRefresh: "Обновить",
			usageRefreshing: "Обновление…",
			usageNotSignedIn: "Войдите, чтобы увидеть использование, о котором сообщает Cursor.",
			usageLoading: "Чтение использования…",
			usageUpdated: "Обновлено {value}",
			plan: "Тариф",
			unlimited: "Без ограничений",
			includedRequests: "Включённые запросы",
			requestsUsed: "Использовано {used} / {limit} запросов ({pct}%)",
			onDemandSpend: "Расходы по требованию",
			autoUsage: "Использование моделей Cursor по тарифу",
			otherModels: "Использование других моделей по тарифу",
			modelUsage: "Использование по моделям",
			spendUsedOf: "Потрачено ${used} / ${limit}",
			billingCycle: "Расчётный период",
			billingDaysLeft: "Осталось {value} дн.",
			autoPercent: "Модели Cursor по тарифу {value}%",
			otherModelsPercent: "Другие модели по тарифу {value}%",
			otherModelsUnknown: "Это значение использования ещё не прочитано",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "Модели",
			modelsRefresh: "Обновить модели",
			modelsRefreshing: "Обновление…",
			modelsCount: "Моделей: {value}",
			modelsLoading: "Чтение списка моделей…",
			runtimeSettings: "Параметры выполнения",
			runtimeSettingsNote: "Параметры сохраняются в текущем profile DSH и применяются со следующего запроса к Cursor.",
			maxToolRounds: "Максимум раундов инструментов",
			maxToolRoundsHint: "Раунды инструментов, разрешённые в одной задаче Cursor, после чего срабатывает TOOL_LIMIT. Диапазон: 1–1000.",
			retryCount: "Число повторов",
			retryCountHint: "Дополнительные попытки для совпадающих статусов. По умолчанию: 0 (выключено). Включение повторов может продублировать работу удалённой модели Cursor или расход. Диапазон: 0–10.",
			retryInterval: "Интервал повтора (мс)",
			retryIntervalHint: "Фиксированная задержка перед каждым повтором HTTP. Диапазон: 0–300000.",
			retryStatuses: "HTTP-статусы для повтора",
			retryStatusesHint: "Через запятую, например: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Сохранить параметры",
			savingSettings: "Сохранение…",
			reloadSettings: "Перезагрузить",
			loadingSettings: "Загрузка…",
			settingsSaved: "Параметры сохранены.",
			settingsLoadFailed: "Не удалось прочитать параметры выполнения.",
			settingsSaveFailed: "Не удалось сохранить параметры выполнения.",
			settingsInvalid: "Проверьте раунды инструментов, число повторов, интервал и HTTP-статусы.",
		};
		const ptBr = {
			nav: "Cursor",
			title: "Assinatura do Cursor",
			connected: "Conectado",
			disconnected: "Não conectado",
			accountLoading: "Lendo o status da conta…",
			login: "Entrar pelo navegador",
			logout: "Sair",
			cancel: "Cancelar",
			openLogin: "Abrir a página de login",
			waiting: "Aguardando a conclusão do login…",
			failed: "Falha no login. Tente novamente.",
			loadFailed: "Não foi possível ler o estado do Cursor.",
			note: "Depois de entrar com uma conta Cursor no navegador, os modelos da assinatura do Cursor ficam disponíveis no seletor de modelos. As credenciais permanecem neste computador.",
			expiresAt: "Token válido até {value}",
			usage: "Uso da assinatura",
			usageRefresh: "Atualizar",
			usageRefreshing: "Atualizando…",
			usageNotSignedIn: "Entre para ver o uso informado pelo Cursor.",
			usageLoading: "Lendo o uso…",
			usageUpdated: "Atualizado em {value}",
			plan: "Plano",
			unlimited: "Ilimitado",
			includedRequests: "Requisições incluídas",
			requestsUsed: "{used} / {limit} requisições usadas ({pct}%)",
			onDemandSpend: "Gasto sob demanda",
			autoUsage: "Uso dos modelos Cursor do plano",
			otherModels: "Uso de outros modelos do plano",
			modelUsage: "Uso por modelo",
			spendUsedOf: "${used} / ${limit} gastos",
			billingCycle: "Ciclo de cobrança",
			billingDaysLeft: "{value} dias restantes",
			autoPercent: "Modelos Cursor do plano {value}%",
			otherModelsPercent: "Outros modelos do plano {value}%",
			otherModelsUnknown: "Este valor de uso ainda não foi lido",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "Modelos",
			modelsRefresh: "Atualizar modelos",
			modelsRefreshing: "Atualizando…",
			modelsCount: "{value} modelos",
			modelsLoading: "Lendo a lista de modelos…",
			runtimeSettings: "Configurações de execução",
			runtimeSettingsNote: "As configurações são salvas no profile do DSH atual e valem a partir da próxima requisição ao Cursor.",
			maxToolRounds: "Máximo de rodadas de ferramentas",
			maxToolRoundsHint: "Rodadas de ferramentas permitidas em uma tarefa do Cursor antes de o TOOL_LIMIT interromper. Faixa: 1–1000.",
			retryCount: "Número de tentativas",
			retryCountHint: "Tentativas adicionais para os status correspondentes. Padrão: 0 (desativado). Ativar tentativas pode repetir trabalho ou uso do modelo remoto do Cursor. Faixa: 0–10.",
			retryInterval: "Intervalo entre tentativas (ms)",
			retryIntervalHint: "Espera fixa antes de cada nova tentativa HTTP. Faixa: 0–300000.",
			retryStatuses: "Códigos de status HTTP com nova tentativa",
			retryStatusesHint: "Separados por vírgula, por exemplo: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Salvar configurações",
			savingSettings: "Salvando…",
			reloadSettings: "Recarregar",
			loadingSettings: "Carregando…",
			settingsSaved: "Configurações salvas.",
			settingsLoadFailed: "Não foi possível ler as configurações de execução.",
			settingsSaveFailed: "Não foi possível salvar as configurações de execução.",
			settingsInvalid: "Verifique as rodadas de ferramentas, o número de tentativas, o intervalo e os códigos de status HTTP.",
		};
		const it = {
			nav: "Cursor",
			title: "Abbonamento Cursor",
			connected: "Connesso",
			disconnected: "Non connesso",
			accountLoading: "Lettura dello stato dell'account…",
			login: "Accedi dal browser",
			logout: "Esci",
			cancel: "Annulla",
			openLogin: "Apri la pagina di accesso",
			waiting: "In attesa del completamento dell'accesso…",
			failed: "Accesso non riuscito. Riprova.",
			loadFailed: "Impossibile leggere lo stato di Cursor.",
			note: "Dopo aver eseguito l'accesso con un account Cursor nel browser, i modelli dell'abbonamento Cursor saranno disponibili nel selettore dei modelli. Le credenziali restano su questo computer.",
			expiresAt: "Token valido fino al {value}",
			usage: "Utilizzo dell'abbonamento",
			usageRefresh: "Aggiorna",
			usageRefreshing: "Aggiornamento…",
			usageNotSignedIn: "Accedi per vedere l'utilizzo comunicato da Cursor.",
			usageLoading: "Lettura dell'utilizzo…",
			usageUpdated: "Aggiornato {value}",
			plan: "Piano",
			unlimited: "Illimitato",
			includedRequests: "Richieste incluse",
			requestsUsed: "{used} / {limit} richieste usate ({pct}%)",
			onDemandSpend: "Spesa on demand",
			autoUsage: "Utilizzo dei modelli Cursor del piano",
			otherModels: "Utilizzo degli altri modelli del piano",
			modelUsage: "Utilizzo per modello",
			spendUsedOf: "${used} / ${limit} spesi",
			billingCycle: "Ciclo di fatturazione",
			billingDaysLeft: "{value} giorni rimanenti",
			autoPercent: "Modelli Cursor del piano {value}%",
			otherModelsPercent: "Altri modelli del piano {value}%",
			otherModelsUnknown: "Questo valore di utilizzo non è ancora stato letto",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "Modelli",
			modelsRefresh: "Aggiorna i modelli",
			modelsRefreshing: "Aggiornamento…",
			modelsCount: "{value} modelli",
			modelsLoading: "Lettura dell'elenco dei modelli…",
			runtimeSettings: "Impostazioni di esecuzione",
			runtimeSettingsNote: "Le impostazioni vengono salvate nel profile DSH corrente e si applicano dalla successiva richiesta a Cursor.",
			maxToolRounds: "Numero massimo di round di strumenti",
			maxToolRoundsHint: "Round di strumenti consentiti in un'attività Cursor prima che TOOL_LIMIT la interrompa. Intervallo: 1–1000.",
			retryCount: "Numero di tentativi",
			retryCountHint: "Tentativi aggiuntivi per gli stati corrispondenti. Predefinito: 0 (disattivato). Attivare i tentativi può ripetere lavoro o utilizzo del modello Cursor remoto. Intervallo: 0–10.",
			retryInterval: "Intervallo tra tentativi (ms)",
			retryIntervalHint: "Attesa fissa prima di ogni nuovo tentativo HTTP. Intervallo: 0–300000.",
			retryStatuses: "Codici di stato HTTP da ritentare",
			retryStatusesHint: "Separati da virgole, ad esempio: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "Salva impostazioni",
			savingSettings: "Salvataggio…",
			reloadSettings: "Ricarica",
			loadingSettings: "Caricamento…",
			settingsSaved: "Impostazioni salvate.",
			settingsLoadFailed: "Impossibile leggere le impostazioni di esecuzione.",
			settingsSaveFailed: "Impossibile salvare le impostazioni di esecuzione.",
			settingsInvalid: "Controlla i round di strumenti, il numero di tentativi, l'intervallo e i codici di stato HTTP.",
		};
		const ar = {
			nav: "Cursor",
			title: "اشتراك Cursor",
			connected: "تم تسجيل الدخول",
			disconnected: "لم يتم تسجيل الدخول",
			accountLoading: "جارٍ قراءة حالة الحساب…",
			login: "تسجيل الدخول عبر المتصفح",
			logout: "تسجيل الخروج",
			cancel: "إلغاء",
			openLogin: "فتح صفحة تسجيل الدخول",
			waiting: "في انتظار اكتمال تسجيل الدخول…",
			failed: "فشل تسجيل الدخول. حاول مرة أخرى.",
			loadFailed: "تعذّر قراءة حالة Cursor.",
			note: "بعد تسجيل الدخول بحساب Cursor في المتصفح، تصبح نماذج اشتراك Cursor متاحة في منتقي النماذج. تبقى بيانات الاعتماد على هذا الجهاز.",
			expiresAt: "الرمز صالح حتى {value}",
			usage: "استخدام الاشتراك",
			usageRefresh: "تحديث",
			usageRefreshing: "جارٍ التحديث…",
			usageNotSignedIn: "سجّل الدخول لعرض الاستخدام الذي يبلّغ عنه Cursor.",
			usageLoading: "جارٍ قراءة الاستخدام…",
			usageUpdated: "حُدّث في {value}",
			plan: "الخطة",
			unlimited: "غير محدود",
			includedRequests: "الطلبات المضمّنة",
			requestsUsed: "استُخدم {used} / {limit} طلبًا ({pct}%)",
			onDemandSpend: "الإنفاق عند الطلب",
			autoUsage: "استخدام نماذج Cursor في الخطة",
			otherModels: "استخدام النماذج الأخرى في الخطة",
			modelUsage: "الاستخدام حسب النموذج",
			spendUsedOf: "أُنفق ${used} / ${limit}",
			billingCycle: "دورة الفوترة",
			billingDaysLeft: "بقي {value} يومًا",
			autoPercent: "نماذج Cursor في الخطة {value}%",
			otherModelsPercent: "النماذج الأخرى في الخطة {value}%",
			otherModelsUnknown: "لم تُقرأ قيمة الاستخدام هذه بعد",
			modelSpendPct: "{model} ${used} ({pct}%)",
			models: "النماذج",
			modelsRefresh: "تحديث النماذج",
			modelsRefreshing: "جارٍ التحديث…",
			modelsCount: "{value} نموذجًا",
			modelsLoading: "جارٍ قراءة قائمة النماذج…",
			runtimeSettings: "إعدادات التشغيل",
			runtimeSettingsNote: "تُحفظ الإعدادات في profile DSH الحالي وتُطبَّق بدءًا من طلب Cursor التالي.",
			maxToolRounds: "الحد الأقصى لجولات الأدوات",
			maxToolRoundsHint: "جولات الأدوات المسموح بها في مهمة Cursor واحدة قبل أن يوقفها TOOL_LIMIT. النطاق: 1–1000.",
			retryCount: "عدد المحاولات",
			retryCountHint: "محاولات إضافية لحالات الاستجابة المطابقة. الافتراضي: 0 (معطّل). قد يؤدي تفعيل المحاولات إلى تكرار عمل النموذج البعيد في Cursor أو استخدامه. النطاق: 0–10.",
			retryInterval: "الفاصل بين المحاولات (مللي ثانية)",
			retryIntervalHint: "انتظار ثابت قبل كل محاولة HTTP جديدة. النطاق: 0–300000.",
			retryStatuses: "رموز حالة HTTP المُعاد المحاولة فيها",
			retryStatusesHint: "مفصولة بفواصل، مثل: 408, 425, 429, 500, 502, 503, 504.",
			saveSettings: "حفظ الإعدادات",
			savingSettings: "جارٍ الحفظ…",
			reloadSettings: "إعادة التحميل",
			loadingSettings: "جارٍ التحميل…",
			settingsSaved: "تم حفظ الإعدادات.",
			settingsLoadFailed: "تعذّر قراءة إعدادات التشغيل.",
			settingsSaveFailed: "تعذّر حفظ إعدادات التشغيل.",
			settingsInvalid: "تحقق من جولات الأدوات وعدد المحاولات والفاصل ورموز حالة HTTP.",
		};

		/** Every dictionary carries the same key set as `en`; a test enforces it. */
		const DICTIONARIES = {
			zh,
			en,
			"zh-Hant": zhHant,
			ja,
			ko,
			es,
			fr,
			de,
			it,
			"pt-BR": ptBr,
			ru,
			ar,
		};

		/**
		 * Languages this panel contributes to the DSH catalog. DSH ships `zh` and
		 * `en` only, so every other language joins the shared catalog through
		 * `locale.addLanguage` and then appears in Settings -> General -> Language.
		 * Each one falls back to `en`, which keeps the rest of the DSH shell
		 * readable for a reader of a contributed language.
		 */
		const LANGUAGES = [
			{ id: "zh-Hant", label: "繁體中文", fallback: "zh" },
			{ id: "ja", label: "日本語", fallback: "en" },
			{ id: "ko", label: "한국어", fallback: "en" },
			{ id: "es", label: "Español", fallback: "en" },
			{ id: "fr", label: "Français", fallback: "en" },
			{ id: "de", label: "Deutsch", fallback: "en" },
			{ id: "it", label: "Italiano", fallback: "en" },
			{ id: "pt-BR", label: "Português (Brasil)", fallback: "en" },
			{ id: "ru", label: "Русский", fallback: "en" },
			{ id: "ar", label: "العربية", fallback: "en" },
		];

		/** Contributed locales written right to left; the panel mirrors for these. */
		const RTL_LOCALES = new Set(["ar"]);
		/** Marker the stylesheet keys the mirrored rules on. */
		const RTL_ATTRIBUTE = "cursorSubscriptionRtl";

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
.cursorSubscriptionVersion{font:500 11px/17px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:6px;padding:1px 6px;direction:ltr}
.cursorSubscriptionFreshness{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionSectionHead{display:flex;align-items:center;justify-content:space-between;gap:12px}
.cursorSubscriptionSectionTitle{display:flex;flex:1;min-width:0;flex-direction:column;gap:2px}
.cursorSubscriptionRefresh{flex:0 0 auto;min-width:72px;width:max-content;white-space:nowrap!important;word-break:keep-all!important;overflow-wrap:normal!important;writing-mode:horizontal-tb!important}
.cursorSubscriptionRefresh *{white-space:nowrap!important;word-break:keep-all!important;writing-mode:horizontal-tb!important}
.cursorSubscriptionEmpty{padding:18px;border:1px dashed var(--dsw-alias-border-l3);border-radius:10px;text-align:center;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionUsageRow{display:flex;flex-direction:column;gap:6px}
.cursorSubscriptionUsageTop{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.cursorSubscriptionUsageLabel{flex:1;min-width:0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.cursorSubscriptionUsageTop strong{font:600 16px/22px ui-monospace,SFMono-Regular,Consolas,monospace;font-variant-numeric:tabular-nums}
.cursorSubscriptionUsageRow progress{width:100%;height:6px;border:0;border-radius:999px;overflow:hidden;background:var(--dsw-alias-border-l3);accent-color:var(--dsw-alias-brand-primary,#3964fe);-webkit-appearance:none;appearance:none}
.cursorSubscriptionUsageRow progress::-webkit-progress-bar{background:var(--dsw-alias-border-l3);border-radius:999px}
.cursorSubscriptionUsageRow progress::-webkit-progress-value{background:var(--dsw-alias-brand-primary,#3964fe);border-radius:999px}
.cursorSubscriptionUsageRow progress::-moz-progress-bar{background:var(--dsw-alias-brand-primary,#3964fe);border-radius:999px}
.cursorSubscriptionModelUsage{display:flex;flex-direction:column;gap:10px;padding-top:4px}
.cursorSubscriptionModelUsageHead{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.cursorSubscriptionMetaRow{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionModels{display:flex;flex-direction:column;gap:8px}
.cursorSubscriptionModelChips{display:flex;flex-wrap:wrap;gap:6px}
.cursorSubscriptionModelChip{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-module-platform);padding:3px 8px;font:500 12px/18px ui-monospace,SFMono-Regular,Consolas,monospace;color:var(--dsw-alias-label-secondary);max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cursorSubscriptionSettingsGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.cursorSubscriptionField{display:flex;flex-direction:column;gap:5px;min-width:0}
.cursorSubscriptionFieldWide{grid-column:1/-1}
.cursorSubscriptionField label{font-size:12px;line-height:18px;font-weight:500;color:var(--dsw-alias-label-secondary)}
.cursorSubscriptionField input{box-sizing:border-box;width:100%;height:34px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);padding:6px 9px;color:var(--dsw-alias-label-primary);font:13px/20px ui-monospace,SFMono-Regular,Consolas,monospace;outline:none}
.cursorSubscriptionField input:focus{border-color:var(--dsw-alias-brand-primary,#3964fe);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary,#3964fe) 18%,transparent)}
.cursorSubscriptionField input:disabled{opacity:.6}
.cursorSubscriptionFieldHint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary)}
.cursorSubscriptionSettingsFoot{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.cursorSubscriptionSuccess{font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary)}
html[data-cursor-subscription-rtl] .cursorSubscription{direction:rtl}
html[data-cursor-subscription-rtl] .cursorSubscriptionUsageRow progress{direction:rtl}
html[data-cursor-subscription-rtl] .cursorSubscriptionField input{direction:ltr;text-align:left}
html[data-cursor-subscription-rtl] .cursorSubscriptionModelChip{direction:ltr}
@container (max-width:520px){.cursorSubscriptionSettingsGrid{grid-template-columns:1fr}.cursorSubscriptionFieldWide{grid-column:auto}}
`;

		const unwrap = (response) => {
			if (!response?.ok) throw new Error(response?.error?.message ?? "Cursor RPC failed");
			return response.value;
		};
		/**
		 * Label one reported build version for the panel header.
		 * @param value - version string reported by the Host.
		 * @returns the `v`-prefixed label, or undefined when nothing usable was reported.
		 */
		const formatVersion = (value) => (typeof value === "string" && value.trim() !== "" ? `v${value.trim()}` : undefined);
		/**
		 * Read the serving build's version through the account channel.
		 * @param rpc - connection RPC client bound to this panel.
		 * @returns the label, or undefined when the call fails or answers without a version.
		 */
		const readVersion = async (rpc) => {
			try {
				const response = await rpc.call(CHANNEL, "version", {});
				return response?.ok ? formatVersion(response.value?.version) : undefined;
			} catch {
				return undefined;
			}
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

		function UsageRow({ label, used, limit, meta }) {
			const available = typeof used === "number" && Number.isFinite(used) && typeof limit === "number" && Number.isFinite(limit) && limit > 0;
			const usedPct = available ? Math.min(100, Math.round((used / limit) * 1000) / 10) : 0;
			const headline = available ? `${percent(usedPct)}%` : "—";
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionUsageRow",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionUsageTop",
						children: [
							react_jsx_runtime.jsx("span", { className: "cursorSubscriptionUsageLabel", children: label }),
							react_jsx_runtime.jsx("strong", { children: headline }),
						],
					}),
					react_jsx_runtime.jsx("progress", {
						max: "100",
						value: usedPct,
						"aria-label": `${label} ${headline}`,
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
			const teamSpend = usage?.teamOnDemand;
			const models = Array.isArray(usage?.models) ? usage.models : [];
			const modelSpendTotal = models.reduce((sum, model) => sum + (Number(model.spentDollars) || 0), 0);
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
												label: t("autoUsage"),
												used: usage.plan.autoPercentUsed,
												limit: 100,
												meta: fill(t("autoPercent"), { value: percent(usage.plan.autoPercentUsed) }),
											})
										: null,
									usage?.plan
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("otherModels"),
												used: typeof usage.plan.apiPercentUsed === "number" ? usage.plan.apiPercentUsed : undefined,
												limit: 100,
												meta: typeof usage.plan.apiPercentUsed === "number" ? fill(t("otherModelsPercent"), { value: percent(usage.plan.apiPercentUsed) }) : t("otherModelsUnknown"),
											})
										: null,
									teamSpend !== undefined && teamSpend.limitDollars !== undefined
										? react_jsx_runtime.jsx(UsageRow, {
												label: t("onDemandSpend"),
												used: teamSpend.usedDollars,
												limit: teamSpend.limitDollars,
												meta: fill(t("spendUsedOf"), { used: money(teamSpend.usedDollars), limit: money(teamSpend.limitDollars) }),
											})
										: null,
									models.length > 0
										? react_jsx_runtime.jsxs("div", {
												className: "cursorSubscriptionModelUsage",
												children: [
													react_jsx_runtime.jsx("span", { className: "cursorSubscriptionModelUsageHead", children: t("modelUsage") }),
													...models.map((model) =>
														react_jsx_runtime.jsx(UsageRow, {
															label: model.id,
															used: model.spentDollars,
															limit: Math.max(modelSpendTotal, model.spentDollars, 0.01),
															meta: fill(t("modelSpendPct"), { model: model.id, used: money(model.spentDollars), pct: percent(model.pct) }),
														}, model.id),
													),
												],
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

		function RuntimeSettingsCard({ rpc, t }) {
			const [form, setForm] = react.useState();
			const [baseline, setBaseline] = react.useState();
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState();
			const [saved, setSaved] = react.useState(false);
			const request = react.useRef(0);
			const call = (endpoint, payload = {}) => rpc.call(CHANNEL, endpoint, payload).then(unwrap);
			const show = (value) => ({
				maxToolRounds: String(value.maxToolRounds),
				retryCount: String(value.retryCount),
				retryIntervalMs: String(value.retryIntervalMs),
				retryHttpStatusCodes: value.retryHttpStatusCodes.join(", "),
			});
			const accept = (value) => {
				setForm(show(value));
				setBaseline({
					maxToolRounds: value.maxToolRounds,
					retryCount: value.retryCount,
					retryIntervalMs: value.retryIntervalMs,
					retryHttpStatusCodes: [...value.retryHttpStatusCodes],
					revision: value.revision,
				});
			};
			const load = () => {
				const id = ++request.current;
				setBusy(true);
				setError(undefined);
				setSaved(false);
				call("settings")
					.then((value) => {
						if (request.current === id) accept(value);
					})
					.catch(() => {
						if (request.current === id) setError(t("settingsLoadFailed"));
					})
					.finally(() => {
						if (request.current === id) setBusy(false);
					});
			};
			react.useEffect(() => {
				load();
				return () => {
					request.current += 1;
				};
			}, []);
			const change = (key) => (event) => {
				const value = event.target.value;
				setForm((current) => ({ ...current, [key]: value }));
				setError(undefined);
				setSaved(false);
			};
			const parse = () => {
				const integer = (value, min, max) => {
					if (!/^\d+$/.test(value.trim())) throw new Error("invalid integer");
					const parsed = Number(value);
					if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error("integer out of range");
					return parsed;
				};
				const statusText = form.retryHttpStatusCodes.trim();
				if (statusText !== "" && !/^\d{3}(?:\s*,\s*\d{3})*$/.test(statusText)) throw new Error("invalid status list");
				const statuses = statusText === "" ? [] : statusText.split(",").map((value) => integer(value, 400, 599));
				if (new Set(statuses).size !== statuses.length) throw new Error("duplicate status");
				return {
					maxToolRounds: integer(form.maxToolRounds, 1, 1000),
					retryCount: integer(form.retryCount, 0, 10),
					retryIntervalMs: integer(form.retryIntervalMs, 0, 300000),
					retryHttpStatusCodes: statuses,
				};
			};
			const save = () => {
				let value;
				try {
					value = parse();
				} catch {
					setError(t("settingsInvalid"));
					setSaved(false);
					return;
				}
				if (baseline === undefined) return;
				const patch = {};
				for (const key of ["maxToolRounds", "retryCount", "retryIntervalMs", "retryHttpStatusCodes"]) {
					if (JSON.stringify(value[key]) !== JSON.stringify(baseline[key])) patch[key] = value[key];
				}
				if (Object.keys(patch).length === 0) {
					setError(undefined);
					setSaved(true);
					return;
				}
				const id = ++request.current;
				setBusy(true);
				setError(undefined);
				setSaved(false);
				call("settings/update", { ...patch, revision: baseline.revision })
					.then((next) => {
						if (request.current !== id) return;
						accept(next);
						setSaved(true);
					})
					.catch(() => {
						if (request.current === id) setError(t("settingsSaveFailed"));
					})
					.finally(() => {
						if (request.current === id) setBusy(false);
					});
			};
			const field = (key, label, hint, properties = {}) =>
				react_jsx_runtime.jsxs("div", {
					className: `cursorSubscriptionField${properties.wide ? " cursorSubscriptionFieldWide" : ""}`,
					children: [
						react_jsx_runtime.jsx("label", { htmlFor: `cursor-subscription-${key}`, children: t(label) }),
						react_jsx_runtime.jsx("input", {
							id: `cursor-subscription-${key}`,
							type: properties.type ?? "number",
							min: properties.min,
							max: properties.max,
							step: "1",
							disabled: busy || form === undefined,
							value: form?.[key] ?? "",
							onChange: change(key),
						}),
						react_jsx_runtime.jsx("span", { className: "cursorSubscriptionFieldHint", children: t(hint) }),
					],
				});
			return react_jsx_runtime.jsxs("div", {
				className: "cursorSubscriptionCard",
				children: [
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionSectionTitle",
						children: [
							react_jsx_runtime.jsx("h3", { children: t("runtimeSettings") }),
							react_jsx_runtime.jsx("p", { className: "cursorSubscriptionFreshness", children: t("runtimeSettingsNote") }),
						],
					}),
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionSettingsGrid",
						children: [
							field("maxToolRounds", "maxToolRounds", "maxToolRoundsHint", { min: 1, max: 1000 }),
							field("retryCount", "retryCount", "retryCountHint", { min: 0, max: 10 }),
							field("retryIntervalMs", "retryInterval", "retryIntervalHint", { min: 0, max: 300000 }),
							field("retryHttpStatusCodes", "retryStatuses", "retryStatusesHint", { type: "text", wide: true }),
						],
					}),
					error === undefined ? null : react_jsx_runtime.jsx("p", { className: "cursorSubscriptionError", role: "alert", children: error }),
					react_jsx_runtime.jsxs("div", {
						className: "cursorSubscriptionSettingsFoot",
						children: [
							saved ? react_jsx_runtime.jsx("p", { className: "cursorSubscriptionSuccess", role: "status", children: t("settingsSaved") }) : react_jsx_runtime.jsx("span", {}),
							react_jsx_runtime.jsx(_deepseek_ai_dsh_client_ui_primitives.Button, {
								type: "button",
								variant: "primary",
								disabled: busy || (form !== undefined && baseline === undefined),
								onClick: form === undefined ? load : save,
								children: busy
									? form === undefined ? t("loadingSettings") : t("savingSettings")
									: form === undefined ? t("reloadSettings") : t("saveSettings"),
							}),
						],
					}),
				],
			});
		}

		function CursorSection({ rpc, t }) {
			const [account, setAccount] = react.useState();
			const [error, setError] = react.useState();
			const [resetKey, setResetKey] = react.useState(0);
			const [version, setVersion] = react.useState();
			react.useEffect(() => {
				let live = true;
				readVersion(rpc).then((label) => {
					if (live) setVersion(label);
				});
				return () => {
					live = false;
				};
			}, []);
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
						children: [
							react_jsx_runtime.jsx("h2", { children: t("title") }),
							version === undefined
								? null
								: react_jsx_runtime.jsx("span", {
										className: "cursorSubscriptionVersion",
										title: `dsh-cursor-subscription ${version}`,
										children: version,
									}),
						],
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
					react_jsx_runtime.jsx(RuntimeSettingsCard, { rpc, t }),
					react_jsx_runtime.jsx("p", { className: "cursorSubscriptionNote", children: t("note") }),
				],
			});
		}

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), "cursor-subscription: copy");
			// Contribute the panel's extra languages to the shared catalog. A locale
			// id may already be owned by DSH itself or by another language pack: that
			// is not an error, the dictionary above simply joins the existing one. An
			// older locale runtime without language packs has no `addLanguage`, which
			// leaves the built-in zh/en panel in place instead of failing the client.
			ctx.effect(() => {
				const disposers = [];
				for (const language of LANGUAGES) {
					const taken = ctx.locale.getLocale().locales.some((entry) => entry.id === language.id);
					if (taken) continue;
					try {
						disposers.push(ctx.locale.addLanguage(language));
					} catch {
						/* an occupied id or an unavailable fallback leaves the panel working */
					}
				}
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "cursor-subscription: languages");
			// Mirror the panel while a right-to-left language is active. The marker
			// rides the document element so the stylesheet can scope it; nothing else
			// in the shell is affected.
			ctx.effect(() => {
				const root = document.documentElement;
				const sync = () => {
					if (RTL_LOCALES.has(ctx.locale.getLocale().active)) root.dataset[RTL_ATTRIBUTE] = "";
					else delete root.dataset[RTL_ATTRIBUTE];
				};
				sync();
				const off = ctx.locale.subscribe(sync);
				return () => {
					off();
					delete root.dataset[RTL_ATTRIBUTE];
				};
			}, "cursor-subscription: direction");
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
		// Pure helpers the panel's tests pin; the DSH client module loader reads only apply/inject.
		exports.formatVersion = formatVersion;
		exports.readVersion = readVersion;
		return module.exports;
	},
});
