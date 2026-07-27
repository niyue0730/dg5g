import { useId } from 'react';
import { Icon } from '@/ui/foundation/icons';
import {
  boxesOverlap,
  connector,
  label,
  object,
  pointTouchesBox,
  type AnnotatedEngineeringFigureKind,
  type EngineeringFigureSpec,
} from './annotated-engineering-figure-model';

export type { AnnotatedEngineeringFigureKind } from './annotated-engineering-figure-model';

export const engineeringFigureSpecs: Record<AnnotatedEngineeringFigureKind, EngineeringFigureSpec> = {
  topology: {
    title: '设备位置、身份与连接方向证据图',
    description: '从机房与机柜位置开始，核对设备铭牌，再沿实际端口和光纤方向确认连接关系。',
    reasoning: '先固定位置，再确认对象身份，最后沿端口发送端到接收端记录方向；三类证据缺一不可。',
    objects: [
      object('rack-location', '机房 A · 机柜 02', '位置：楼层、房间、机柜号', 'room', 70, 145, 210, 150, 'cyan'),
      object('device-identity', 'BBU · 槽位 3', '身份：型号、SN、槽位标签', 'bbu', 375, 155, 205, 130, 'green'),
      object('connection-direction', '光口 1 → RRU 02', '方向：端口、纤芯、收发端', 'rru', 680, 155, 210, 130, 'amber'),
    ],
    connectors: [
      connector('rack-to-device', 'rack-location', 'device-identity', 280, 220, 375, 220),
      connector('device-to-radio', 'device-identity', 'connection-direction', 580, 220, 680, 220),
    ],
    labels: [
      label('rack-location', '01 位置证据', '门牌、机房、机柜编号同框', 35, 28, 250, 66, 175, 145),
      label('device-identity', '02 身份证据', '铭牌、SN、槽位标签可互证', 355, 28, 250, 66, 478, 155),
      label('connection-direction', '03 方向证据', '两端端口与光纤标签成对记录', 675, 28, 250, 66, 785, 155),
    ],
  },
  antenna: {
    title: '天线姿态三项证据图',
    description: '以正北参考、天线面板、地面基准和目标覆盖方向共同说明方位角、下倾角与挂高。',
    reasoning: '方位角必须有北向基准，下倾角必须记录面板机械或电子刻度，挂高必须从统一地面基准量到天线中心。',
    objects: [
      object('north-reference', '正北基准', '罗盘校准后记录方位', 'gps', 65, 165, 185, 105, 'cyan'),
      object('antenna-panel', 'AAU 天线面板', '扇区号、面板刻度、中心点', 'radio', 400, 105, 175, 195, 'green'),
      object('coverage-target', '目标覆盖方向', '主瓣指向与道路/建筑对应', 'target', 720, 175, 180, 105, 'amber'),
      object('ground-reference', '统一地面基准', '挂高测量起点', 'site', 400, 330, 175, 80, 'cyan'),
    ],
    connectors: [
      connector('north-to-panel', 'north-reference', 'antenna-panel', 250, 217, 400, 217),
      connector('panel-to-target', 'antenna-panel', 'coverage-target', 575, 202, 720, 227),
      connector('panel-to-ground', 'antenna-panel', 'ground-reference', 487, 300, 487, 330),
    ],
    labels: [
      label('azimuth-evidence', '01 方位角证据', '正北基准 → 面板主瓣方向', 28, 24, 265, 66, 158, 165),
      label('downtilt-evidence', '02 下倾角证据', '面板刻度 + 电子下倾参数', 348, 24, 265, 66, 487, 105),
      label('height-evidence', '03 挂高证据', '地面基准 → 天线中心点', 668, 24, 265, 66, 810, 175),
    ],
  },
  complaint: {
    title: '投诉同条件复现场景证据图',
    description: '将投诉记录拆成地点、业务和终端三个可核对条件，再在相同条件下形成复测记录。',
    reasoning: '只有地点、业务动作和终端条件一致，复测现象才可以与原投诉比较；更换任一条件都不能直接否定投诉。',
    objects: [
      object('complaint-record', '原投诉记录', '时间、现象、发生频次', 'complaint', 45, 165, 200, 115, 'amber'),
      object('same-location', '同地点', '楼栋、楼层、房间/道路点位', 'gps', 345, 70, 190, 78, 'cyan'),
      object('same-business', '同业务', '同一应用、动作与持续时长', 'signaling', 345, 170, 190, 78, 'green'),
      object('same-device', '同终端', '型号、网络模式、卡槽与版本', 'user', 345, 270, 190, 78, 'cyan'),
      object('reproduction-record', '同条件复测记录', '现象、服务小区、指标与日志', 'log', 690, 165, 220, 115, 'green'),
    ],
    connectors: [
      connector('complaint-to-location', 'complaint-record', 'same-location', 245, 190, 345, 109),
      connector('complaint-to-business', 'complaint-record', 'same-business', 245, 222, 345, 209),
      connector('complaint-to-device', 'complaint-record', 'same-device', 245, 255, 345, 309),
      connector('location-to-record', 'same-location', 'reproduction-record', 535, 109, 690, 190),
      connector('business-to-record', 'same-business', 'reproduction-record', 535, 209, 690, 222),
      connector('device-to-record', 'same-device', 'reproduction-record', 535, 309, 690, 255),
    ],
    labels: [
      label('complaint-source', '01 固定原始事实', '先记录，不先归因', 28, 22, 250, 58, 145, 165),
      label('same-condition', '02 锁定三项条件', '地点、业务、终端逐项一致', 355, 365, 245, 58, 440, 348),
      label('reproduction-evidence', '03 同口径比较', '复测现象与网络证据同步留痕', 675, 22, 255, 58, 800, 165),
    ],
  },
};

export function AnnotatedEngineeringFigure({
  kind,
  evidenceLabels = [],
}: {
  kind: AnnotatedEngineeringFigureKind;
  evidenceLabels?: readonly string[];
}) {
  const spec = engineeringFigureSpecs[kind];
  const id = useId().replace(/:/g, '');
  const titleId = `engineering-figure-${kind}-${id}`;
  const markerId = `engineering-arrow-${kind}-${id}`;

  return (
    <figure className={`annotated-engineering-figure is-${kind}`} data-annotated-engineering-figure={kind}>
      <header>
        <span>工程证据图 · {kindLabel[kind]}</span>
        <h3 id={titleId}>{spec.title}</h3>
        <p>{spec.description}</p>
      </header>
      <div className="engineering-figure-canvas">
        {kind === 'topology' ? (
          <img
            alt="机柜02、BBU槽位3、AAU/RRU与端口链组成的5G室内设备拓扑"
            className="engineering-figure-stage-image"
            src="/media/5g/p01-n02-topology-stage-v1.png"
          />
        ) : null}
        <svg aria-labelledby={titleId} role="img" viewBox={kind === 'topology' ? '0 0 960 540' : '0 0 960 430'}>
          <desc>{spec.reasoning}</desc>
          <defs>
            <pattern height="24" id={`engineering-grid-${id}`} patternUnits="userSpaceOnUse" width="24">
              <path d="M24 0H0V24" fill="none" />
            </pattern>
            <marker id={markerId} markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="4">
              <path d="M0 0 8 4 0 8Z" />
            </marker>
          </defs>
          <rect className="engineering-grid" fill={`url(#engineering-grid-${id})`} height="430" width="960" />

          <g className="engineering-leader-layer" aria-hidden="true">
            {spec.labels.map((item) => (
              <path d={`M${item.x + item.width / 2} ${item.y + item.height} L${item.targetX} ${item.targetY}`} key={item.id} />
            ))}
          </g>
          <g className="engineering-connector-layer" aria-hidden="true">
            {spec.connectors.map((item) => (
              <line
                data-connector-id={item.id}
                data-source={item.sourceId}
                data-target={item.targetId}
                key={item.id}
                markerEnd={`url(#${markerId})`}
                x1={item.x1}
                x2={item.x2}
                y1={item.y1}
                y2={item.y2}
              />
            ))}
          </g>
          <g className="engineering-object-layer">
            {spec.objects.map((item) => (
              <g
                className={`engineering-object is-${item.tone}`}
                data-figure-object={item.id}
                key={item.id}
                transform={`translate(${item.x} ${item.y})`}
              >
                <rect height={item.height} rx="7" width={item.width} />
                <g className="engineering-object-icon" transform="translate(16 18)">
                  <Icon name={item.icon} size={26} />
                </g>
                <text className="engineering-object-title" x="54" y="34">{item.label}</text>
                <text className="engineering-object-detail" x="16" y={item.height - 22}>{item.detail}</text>
              </g>
            ))}
          </g>
          <g className="engineering-label-layer">
            {spec.labels.map((item) => (
              <g data-figure-label={item.id} key={item.id} transform={`translate(${item.x} ${item.y})`}>
                <rect height={item.height} rx="6" width={item.width} />
                <text className="engineering-label-title" x="13" y="24">{item.title}</text>
                <text className="engineering-label-detail" x="13" y={item.height - 14}>{item.text}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <ol className="engineering-mobile-evidence" data-mobile-evidence-list={kind}>
        {spec.labels.map((item) => (
          <li data-mobile-evidence={item.id} key={item.id}>
            <span>{item.title}</span>
            <strong>{item.text}</strong>
          </li>
        ))}
      </ol>
      <figcaption>
        <strong>判断路径</strong>
        <p>{spec.reasoning}</p>
        {evidenceLabels.length ? <ul aria-label="本图证据清单">
          {evidenceLabels.map((item) => <li key={item}>{item}</li>)}
        </ul> : null}
      </figcaption>
    </figure>
  );
}

export function validateEngineeringFigureSpec(kind: AnnotatedEngineeringFigureKind): string[] {
  const spec = engineeringFigureSpecs[kind];
  const errors: string[] = [];
  const objects = new Map(spec.objects.map((item) => [item.id, item]));
  const canvas = { width: 960, height: 430 };

  for (const connector of spec.connectors) {
    const source = objects.get(connector.sourceId);
    const target = objects.get(connector.targetId);
    if (!source || !target) {
      errors.push(`${connector.id}: missing source or target`);
      continue;
    }
    if (!pointTouchesBox(connector.x1, connector.y1, source)) errors.push(`${connector.id}: source endpoint misses boundary`);
    if (!pointTouchesBox(connector.x2, connector.y2, target)) errors.push(`${connector.id}: target endpoint misses boundary`);
  }

  for (const item of spec.objects) {
    if (item.height < 64) errors.push(`${item.id}: object is too short for two readable text lines`);
    if (item.x < 0 || item.y < 0 || item.x + item.width > canvas.width || item.y + item.height > canvas.height) {
      errors.push(`${item.id}: object leaves canvas`);
    }
  }

  for (const item of spec.labels) {
    if (item.height < 58) errors.push(`${item.id}: label is too short for title and detail`);
    if (item.x < 0 || item.y < 0 || item.x + item.width > canvas.width || item.y + item.height > canvas.height) {
      errors.push(`${item.id}: label leaves canvas`);
    }
  }

  for (let left = 0; left < spec.objects.length; left += 1) {
    for (let right = left + 1; right < spec.objects.length; right += 1) {
      if (boxesOverlap(spec.objects[left]!, spec.objects[right]!)) {
        errors.push(`${spec.objects[left]!.id}/${spec.objects[right]!.id}: objects overlap`);
      }
    }
  }

  for (let left = 0; left < spec.labels.length; left += 1) {
    for (let right = left + 1; right < spec.labels.length; right += 1) {
      if (boxesOverlap(spec.labels[left]!, spec.labels[right]!)) {
        errors.push(`${spec.labels[left]!.id}/${spec.labels[right]!.id}: labels overlap`);
      }
    }
    for (const item of spec.objects) {
      if (boxesOverlap(spec.labels[left]!, item)) {
        errors.push(`${spec.labels[left]!.id}/${item.id}: label overlaps object`);
      }
    }
  }
  return errors;
}

const kindLabel: Record<AnnotatedEngineeringFigureKind, string> = { topology: '设备拓扑', antenna: '天线姿态', complaint: '投诉复现' };
