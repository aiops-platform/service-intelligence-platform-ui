# service-intelligence-platform-ui

## Monitor Targets — Manual Run（暂移除）

Observability › APM › Monitor Targets 页面曾提供 **Manual Run**（手动触发一轮检测，`POST /v1/monitors/{id}/run`），因当前阶段暂不需要，已从模态框中移除（含列表行 Run 按钮）。

后续如菜单/流程需要，可重新加回：`index.html` 的 `apm-form-actions` 增加 `Manual Run` 按钮，`js/app.js` 恢复 `manualRun()`、列表行 `data-act="run"`、`onListAction` 的 run 分支与事件绑定即可，后端接口未变。
