/* =========================================================================
 * 3. OpenAI 兼容接口请求层
 * ========================================================================= */
function requestOpenAI(prompt, systemPrompt, config) {
  return new Promise((resolve, reject) => {
    const apiKey = (config.openaiApiKey || '').trim();
    if (!apiKey) {
      return reject(new Error('未填写 OpenAI API Key，请在助手面板中配置！'));
    }

    let baseUrl = (config.openaiBaseUrl || 'https://api.openai.com/v1').trim().replace(/\/+$/, '');
    const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';

    const messages = [
      {
        role: 'system',
        content:
          systemPrompt ||
          '你是一个专业严谨的网课做题助手。请根据用户提供的题目、题型以及可选选项，给出最准确的答案。\n' +
            '【输出规范】\n' +
            '1. 单选题：只输出正确选项的大写英文字母，例如：A\n' +
            '2. 多选题：只输出所有正确选项的大写英文字母组合，例如：ABCD\n' +
            '3. 判断题：若选项为A/B则输出A或B；否则只输出"正确"或"错误"（或"对"或"错"）\n' +
            '4. 填空题：只输出各空答案，多个空之间必须用井号"#"隔开，例如：答案1#答案2\n' +
            '5. 简答题/名词解释/计算题：直接输出精简准确的答案内容\n' +
            '【注意】绝对不要包含任何解析、说明、思考过程或多余标点！'
      },
      {
        role: 'user',
        content: prompt
      }
    ];

    const body = {
      model: config.openaiModel || 'gpt-4o-mini',
      messages: messages,
      temperature: typeof config.openaiTemperature === 'number' ? config.openaiTemperature : 0.1
    };

    const headers = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    };

    // 优先使用油猴专用的 GM_xmlhttpRequest 解决跨域限制
    if (typeof GM_xmlhttpRequest !== 'undefined') {
      GM_xmlhttpRequest({
        method: 'POST',
        url: endpoint,
        headers: headers,
        data: JSON.stringify(body),
        timeout: 45000,
        onload: function (res) {
          try {
            const data = JSON.parse(res.responseText);
            if (res.status >= 200 && res.status < 300) {
              const answer = data.choices?.[0]?.message?.content || '';
              resolve(answer);
            } else {
              const errMsg = data.error?.message || `HTTP ${res.status}: ${res.statusText}`;
              reject(new Error(errMsg));
            }
          } catch (e) {
            reject(new Error(`响应数据解析失败: ${res.responseText.slice(0, 100)}`));
          }
        },
        ontimeout: function () {
          reject(new Error('请求超时 (45s)，请检查 API 地址与网络连接'));
        },
        onerror: function (err) {
          reject(new Error('网络请求异常，请检查接口地址与代理设置'));
        }
      });
    } else {
      // 原生 fetch 降级处理
      fetch(endpoint, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body)
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.choices?.[0]?.message?.content) {
            resolve(data.choices[0].message.content);
          } else {
            reject(new Error(data.error?.message || '请求失败'));
          }
        })
        .catch(reject);
    }
  });
}
