import { css } from '@emotion/css';
import React, { useCallback, useEffect } from 'react';
import { lastValueFrom } from 'rxjs';

import {
  CoreApp,
  DataFrame,
  DataQueryRequest,
  DataSourceInstanceSettings,
  DataSourceJsonData,
  dateTime,
  TimeZone,
} from '@grafana/data';
import { FlameGraph } from '@grafana/flamegraph';
import { config } from '@grafana/runtime';
import { useStyles2 } from '@grafana/ui';
import { TraceToProfilesOptions } from 'app/core/components/TraceToProfiles/TraceToProfilesSettings';
import { getDatasourceSrv } from 'app/features/plugins/datasource_srv';
import { PyroscopeQueryType } from 'app/plugins/datasource/grafana-pyroscope-datasource/dataquery.gen';
import { PyroscopeDataSource } from 'app/plugins/datasource/grafana-pyroscope-datasource/datasource';
import { Query } from 'app/plugins/datasource/grafana-pyroscope-datasource/types';

import { pyroscopeProfileTag } from '../../../createSpanLink';
import { TraceSpan } from '../../types/trace';

import { TraceFlameGraphs } from '.';

export type SpanFlameGraphProps = {
  span: TraceSpan;
  traceToProfilesOptions?: TraceToProfilesOptions;
  timeZone: TimeZone;
  traceFlameGraphs: TraceFlameGraphs;
  setTraceFlameGraphs: (flameGraphs: TraceFlameGraphs) => void;
};

export default function SpanFlameGraph(props: SpanFlameGraphProps) {
  const { span, traceToProfilesOptions, timeZone, traceFlameGraphs, setTraceFlameGraphs } = props;
  const styles = useStyles2(getStyles);

  const getTimeRangeForProfile = useCallback(() => {
    const spanStartMs = Math.floor(span.startTime / 1000) - 30000;
    const spanEndMs = (span.startTime + span.duration) / 1000 + 30000;
    const to = dateTime(spanEndMs);
    const from = dateTime(spanStartMs);

    return {
      from,
      to,
      raw: {
        from,
        to,
      },
    };
  }, [span.duration, span.startTime]);

  const getFlameGraphData = async (request: DataQueryRequest<Query>, datasourceUid: string) => {
    const ds = await getDatasourceSrv().get(datasourceUid);
    if (ds instanceof PyroscopeDataSource) {
      const result = await lastValueFrom(ds.query(request));
      const frame = result.data.find((x: DataFrame) => {
        return x.name === 'response';
      });
      if (frame && frame.length > 1) {
        return frame;
      }
    }
  };

  const queryFlameGraph = useCallback(
    async (
      profilesDataSourceSettings: DataSourceInstanceSettings<DataSourceJsonData>,
      traceToProfilesOptions: TraceToProfilesOptions
    ) => {
      const request = {
        requestId: 'span-flamegraph-requestId',
        interval: '2s',
        intervalMs: 2000,
        range: getTimeRangeForProfile(),
        scopedVars: {},
        app: CoreApp.Unknown,
        timezone: timeZone,
        startTime: span.startTime,
        targets: [
          {
            labelSelector: '{}',
            groupBy: [],
            profileTypeId: traceToProfilesOptions.profileTypeId ?? '',
            queryType: 'profile' as PyroscopeQueryType,
            spanSelector: [span.spanID],
            refId: 'span-flamegraph-refId',
            datasource: {
              type: profilesDataSourceSettings.type,
              uid: profilesDataSourceSettings.uid,
            },
          },
        ],
      };
      const flameGraph = await getFlameGraphData(request, profilesDataSourceSettings.uid);

      if (flameGraph && flameGraph.length > 0) {
        setTraceFlameGraphs({ ...traceFlameGraphs, [span.spanID]: flameGraph });
      }
    },
    [getTimeRangeForProfile, setTraceFlameGraphs, span.spanID, span.startTime, timeZone, traceFlameGraphs]
  );

  useEffect(() => {
    if (config.featureToggles.traceToProfiles && !Object.keys(traceFlameGraphs).includes(span.spanID)) {
      let profilesDataSourceSettings: DataSourceInstanceSettings<DataSourceJsonData> | undefined;
      if (traceToProfilesOptions?.datasourceUid) {
        profilesDataSourceSettings = getDatasourceSrv().getInstanceSettings(traceToProfilesOptions.datasourceUid);
      }
      const hasPyroscopeProfile = span.tags.some((tag) => tag.key === pyroscopeProfileTag);

      if (hasPyroscopeProfile && traceToProfilesOptions && profilesDataSourceSettings) {
        queryFlameGraph(profilesDataSourceSettings, traceToProfilesOptions);
      }
    }
  }, [
    setTraceFlameGraphs,
    span.tags,
    traceFlameGraphs,
    traceToProfilesOptions,
    getTimeRangeForProfile,
    span.startTime,
    timeZone,
    span.spanID,
    queryFlameGraph,
  ]);

  if (!traceFlameGraphs[span.spanID]) {
    return <></>;
  }

  return (
    <div className={styles.flameGraph}>
      <>
        <div className={styles.flameGraphTitle}>Flame graph</div>
        <FlameGraph data={traceFlameGraphs[span.spanID]} getTheme={() => config.theme2} showFlameGraphOnly={true} />
      </>
    </div>
  );
}

const getStyles = () => {
  return {
    flameGraph: css({
      label: 'flameGraphInSpan',
      margin: '5px',
    }),
    flameGraphTitle: css({
      label: 'flameGraphTitleInSpan',
      marginBottom: '5px',
      fontWeight: 'bold',
    }),
  };
};
